use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

const MISSING_API_KEY_MESSAGE: &str = "未配置 API Key，请先在 Settings Page 配置。";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum IdeaStatus {
    NotStarted,
    InProgress,
    Completed,
    Abandoned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Priority {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TodoStatus {
    Todo,
    InProgress,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RepositoryType {
    LocalFolder,
    LocalFile,
    Github,
    Overleaf,
    Pdf,
    Dataset,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryDraft {
    name: String,
    #[serde(rename = "type")]
    repository_type: RepositoryType,
    url_or_path: String,
    note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoDraft {
    title: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    status: Option<TodoStatus>,
    #[serde(default)]
    priority: Option<Priority>,
    #[serde(default)]
    due_date: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdeaDraft {
    title: String,
    content: String,
    plan: String,
    #[serde(default)]
    todos: Vec<TodoDraft>,
    repositories: Vec<RepositoryDraft>,
    status: IdeaStatus,
    tags: Vec<String>,
    priority: Priority,
    #[serde(default)]
    target_date: Option<String>,
    #[serde(default)]
    progress: Option<u8>,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmConfig {
    provider: String,
    base_url: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTodoAiInput {
    title: String,
    content: String,
    plan: String,
    #[serde(default)]
    notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdeaModifyInput {
    idea: IdeaDraft,
    instruction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoAiResponse {
    todos: Vec<TodoDraft>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TestConnectionResult {
    ok: bool,
    provider: String,
    base_url: String,
    model: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw_error: Option<String>,
}

#[tauri::command]
async fn fetch_llm_models(config: LlmConfig) -> Result<Vec<String>, String> {
    validate_base_settings(&config, false)?;
    match provider_kind(&config.provider).as_str() {
        "anthropic" => Ok(anthropic_model_presets()),
        "openai" | "openai-compatible" => fetch_openai_compatible_models(config).await,
        _ => Err("不支持的 Provider。".to_string()),
    }
}

#[tauri::command]
async fn test_llm_connection(config: LlmConfig) -> Result<TestConnectionResult, String> {
    if let Err(message) = validate_base_settings(&config, true) {
        return Ok(test_result(&config, false, message, None, None));
    }

    let result = match provider_kind(&config.provider).as_str() {
        "anthropic" => test_anthropic_connection(config).await,
        "openai" | "openai-compatible" => test_openai_compatible_connection(config).await,
        _ => Ok(test_result(&config, false, "不支持的 Provider。", None, None)),
    };

    result
}

#[tauri::command]
async fn generate_idea_with_ai(input: String, config: LlmConfig) -> Result<IdeaDraft, String> {
    if input.trim().is_empty() {
        return Err("请输入科研 idea 描述后再生成。".to_string());
    }
    validate_base_settings(&config, true)?;

    let user_prompt = format!(
        "请把下面的自然语言科研想法整理成结构化 IdeaDraft JSON：\n\n{}",
        input.trim()
    );
    request_idea_draft(user_prompt, config).await
}

#[tauri::command]
async fn organize_idea_with_ai(input: IdeaDraft, config: LlmConfig) -> Result<IdeaDraft, String> {
    validate_base_settings(&config, true)?;

    let user_prompt = format!(
        "请整理并增强下面这个科研 idea，保持用户已有意图，不要凭空加入已经完成的进展。返回结构化 IdeaDraft JSON。\n\n{}",
        serde_json::to_string_pretty(&input).map_err(|_| "无法序列化当前 idea。")?
    );
    request_idea_draft(user_prompt, config).await
}

#[tauri::command]
async fn modify_idea_with_ai(input: IdeaModifyInput, config: LlmConfig) -> Result<IdeaDraft, String> {
    if input.instruction.trim().is_empty() {
        return Err("请输入希望 AI 如何修改这个 Idea。".to_string());
    }
    validate_base_settings(&config, true)?;

    let user_prompt = format!(
        "请根据用户的修改需求，基于当前 idea 重新修改并返回完整 IdeaDraft JSON。不要自动确认保存，不要解释。\n\n当前 idea：\n{}\n\n用户修改需求：\n{}",
        serde_json::to_string_pretty(&input.idea).map_err(|_| "无法序列化当前 idea。")?,
        input.instruction.trim()
    );
    request_idea_draft(user_prompt, config).await
}

#[tauri::command]
async fn generate_project_todos_with_ai(input: ProjectTodoAiInput, config: LlmConfig) -> Result<TodoAiResponse, String> {
    validate_base_settings(&config, true)?;
    let user_prompt = format!(
        "Create executable Project Todo items for this research idea. Use the idea context only; do not invent completed work.\n\nTitle:\n{}\n\nContent:\n{}\n\nPlan:\n{}\n\nNotes:\n{}",
        input.title.trim(),
        input.content.trim(),
        input.plan.trim(),
        input.notes.unwrap_or_default().trim()
    );
    request_todo_draft(user_prompt, project_todo_system_prompt(), config).await
}

#[tauri::command]
async fn generate_daily_todos_with_ai(input: String, date: String, config: LlmConfig) -> Result<TodoAiResponse, String> {
    if input.trim().is_empty() {
        return Err("Please enter tasks to organize.".to_string());
    }
    validate_base_settings(&config, true)?;
    let user_prompt = format!(
        "Convert this natural language task note into Daily Todo items for date {}:\n\n{}",
        date.trim(),
        input.trim()
    );
    request_todo_draft(user_prompt, daily_todo_system_prompt(), config).await
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn open_local_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Path does not exist.".to_string());
    }
    open_path_with_system(target)
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("Path does not exist.".to_string());
    }
    reveal_path_with_system(target)
}

async fn fetch_openai_compatible_models(config: LlmConfig) -> Result<Vec<String>, String> {
    let endpoint = join_endpoint(&config.base_url, "models");
    let response = reqwest::Client::new()
        .get(endpoint)
        .bearer_auth(config.api_key.trim())
        .send()
        .await
        .map_err(|error| format!("刷新模型列表失败：{}", error))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("刷新模型列表失败（{}）：{}", status.as_u16(), body));
    }

    let parsed: Value = serde_json::from_str(&body).map_err(|_| "模型列表响应不是有效 JSON。".to_string())?;
    let models = parsed
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .map(str::to_string)
        .collect::<Vec<_>>();

    if models.is_empty() {
        Err("模型列表为空或响应中没有 data[].id。".to_string())
    } else {
        Ok(models)
    }
}

async fn test_openai_compatible_connection(config: LlmConfig) -> Result<TestConnectionResult, String> {
    let endpoint = join_endpoint(&config.base_url, "chat/completions");
    let payload = json!({
        "model": config.model.trim(),
        "messages": [{ "role": "user", "content": "Reply with OK only." }],
        "temperature": 0,
        "max_tokens": 8
    });

    let response = match reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(config.api_key.trim())
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Ok(test_result(
                &config,
                false,
                "连接失败，请检查 Base URL 或网络。",
                None,
                Some(error.to_string()),
            ));
        }
    };

    response_to_test_result(&config, response, "连接成功，模型可用。").await
}

async fn test_anthropic_connection(config: LlmConfig) -> Result<TestConnectionResult, String> {
    let endpoint = anthropic_messages_endpoint(&config.base_url);
    let payload = json!({
        "model": config.model.trim(),
        "max_tokens": 8,
        "messages": [{ "role": "user", "content": "Reply with OK only." }]
    });

    let response = match reqwest::Client::new()
        .post(endpoint)
        .header("x-api-key", config.api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Ok(test_result(
                &config,
                false,
                "连接失败，请检查 Base URL 或网络。",
                None,
                Some(error.to_string()),
            ));
        }
    };

    response_to_test_result(&config, response, "连接成功，模型可用。").await
}

async fn response_to_test_result(
    config: &LlmConfig,
    response: reqwest::Response,
    success_message: &str,
) -> Result<TestConnectionResult, String> {
    let status = response.status();
    let status_code = Some(status.as_u16());
    let body = response.text().await.unwrap_or_default();

    if status.is_success() {
        Ok(test_result(config, true, success_message, status_code, None))
    } else {
        Ok(test_result(
            config,
            false,
            format!("连接测试失败（{}）。", status.as_u16()),
            status_code,
            Some(body),
        ))
    }
}

async fn request_idea_draft(user_prompt: String, config: LlmConfig) -> Result<IdeaDraft, String> {
    let raw_text = match provider_kind(&config.provider).as_str() {
        "anthropic" => request_anthropic_json(user_prompt, idea_system_prompt(), config, 1800).await?,
        "openai" | "openai-compatible" => request_openai_compatible_json(user_prompt, idea_system_prompt(), config).await?,
        _ => return Err("不支持的 Provider。".to_string()),
    };

    parse_idea_draft(&raw_text)
}

async fn request_todo_draft(user_prompt: String, system_prompt: &'static str, config: LlmConfig) -> Result<TodoAiResponse, String> {
    let raw_text = match provider_kind(&config.provider).as_str() {
        "anthropic" => request_anthropic_json(user_prompt, system_prompt, config, 1400).await?,
        "openai" | "openai-compatible" => request_openai_compatible_json(user_prompt, system_prompt, config).await?,
        _ => return Err("Unsupported provider.".to_string()),
    };

    parse_todo_response(&raw_text)
}

async fn request_openai_compatible_json(user_prompt: String, system_prompt: &'static str, config: LlmConfig) -> Result<String, String> {
    let endpoint = join_endpoint(&config.base_url, "chat/completions");
    let payload = json!({
        "model": config.model.trim(),
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_prompt }
        ],
        "temperature": 0.2,
        "response_format": { "type": "json_object" }
    });

    let response = reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(config.api_key.trim())
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{}", error))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status == StatusCode::UNAUTHORIZED {
        return Err("API Key 无效或无权限，请检查 Settings Page 中的 API Key。".to_string());
    }
    if !status.is_success() {
        return Err(format!("AI 请求失败（{}）：{}", status.as_u16(), body));
    }

    let parsed: Value = serde_json::from_str(&body).map_err(|_| "AI 服务返回了无法解析的响应。".to_string())?;
    parsed
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "AI 响应中没有可用的 message.content。".to_string())
}

async fn request_anthropic_json(
    user_prompt: String,
    system_prompt: &'static str,
    config: LlmConfig,
    max_tokens: u16,
) -> Result<String, String> {
    let endpoint = anthropic_messages_endpoint(&config.base_url);
    let payload = json!({
        "model": config.model.trim(),
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": user_prompt }]
    });

    let response = reqwest::Client::new()
        .post(endpoint)
        .header("x-api-key", config.api_key.trim())
        .header("anthropic-version", ANTHROPIC_VERSION)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{}", error))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if status == StatusCode::UNAUTHORIZED {
        return Err("API Key 无效或无权限，请检查 Settings Page 中的 API Key。".to_string());
    }
    if !status.is_success() {
        return Err(format!("AI 请求失败（{}）：{}", status.as_u16(), body));
    }

    let parsed: Value = serde_json::from_str(&body).map_err(|_| "Anthropic 返回了无法解析的响应。".to_string())?;
    parsed
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .find(|text| !text.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Anthropic 响应中没有可用的 text 内容。".to_string())
}

fn parse_idea_draft(text: &str) -> Result<IdeaDraft, String> {
    let json_text = extract_json_object(text).ok_or_else(|| "AI 返回内容中没有可解析的 JSON 对象。".to_string())?;
    let raw: Value = serde_json::from_str(json_text).map_err(|error| {
        eprintln!("AI idea raw JSON parse error: {}\nRaw text:\n{}", error, json_text);
        "AI 返回的数据结构不符合预期，已尝试自动修复但失败。请重新生成，或检查模型是否支持严格 JSON 输出。".to_string()
    })?;
    normalize_idea_draft(raw).map_err(|error| {
        eprintln!("AI idea normalize error: {}\nRaw JSON:\n{}", error, json_text);
        "AI 返回的数据结构不符合预期，已尝试自动修复但失败。请重新生成，或检查模型是否支持严格 JSON 输出。".to_string()
    })
}

fn parse_todo_response(text: &str) -> Result<TodoAiResponse, String> {
    let json_text = extract_json_value(text).ok_or_else(|| "AI response did not contain JSON.".to_string())?;
    let raw: Value = serde_json::from_str(json_text).map_err(|error| {
        eprintln!("AI todo raw JSON parse error: {}\nRaw text:\n{}", error, json_text);
        "AI returned an invalid todo structure. Please try again.".to_string()
    })?;
    let todos = normalize_todo_response(raw);
    if todos.is_empty() {
        return Err("AI did not return any usable todo items.".to_string());
    }
    Ok(TodoAiResponse { todos })
}

fn normalize_idea_draft(raw: Value) -> Result<IdeaDraft, String> {
    let object = raw
        .as_object()
        .ok_or_else(|| "AI 返回的 JSON 根节点不是对象。".to_string())?;

    let mut draft = IdeaDraft {
        title: value_to_string(object.get("title")).trim().to_string(),
        content: value_to_string(object.get("content")).trim().to_string(),
        plan: value_to_string(object.get("plan")).trim().to_string(),
        todos: normalize_todos(object.get("todos")),
        repositories: normalize_repositories(object.get("repositories")),
        status: normalize_status(object.get("status")),
        tags: normalize_tags(object.get("tags")),
        priority: normalize_priority(object.get("priority")),
        target_date: normalize_target_date(object.get("targetDate")),
        progress: Some(normalize_progress(object.get("progress"))),
        notes: Some(value_to_string(object.get("notes")).trim().to_string()),
    };

    draft.title = draft.title.trim().to_string();
    draft.content = draft.content.trim().to_string();
    draft.plan = draft.plan.trim().to_string();
    draft.repositories = draft
        .repositories
        .into_iter()
        .filter(|repo| !repo.name.trim().is_empty() || !repo.url_or_path.trim().is_empty())
        .collect();
    draft.todos = draft
        .todos
        .into_iter()
        .filter(|todo| !todo.title.trim().is_empty())
        .take(12)
        .collect();
    draft.progress = Some(draft.progress.unwrap_or(0).min(100));

    if draft.title.is_empty() || draft.content.is_empty() || draft.plan.is_empty() {
        return Err("AI 返回的 JSON 字段不完整，请重新生成。".to_string());
    }

    Ok(draft)
}

fn value_to_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Array(values)) => values
            .iter()
            .map(|item| match item {
                Value::String(value) => value.clone(),
                Value::Null => String::new(),
                other => other.to_string(),
            })
            .filter(|item| !item.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Object(value)) => serde_json::to_string_pretty(value).unwrap_or_default(),
        Some(Value::Null) | None => String::new(),
    }
}

fn normalize_tags(value: Option<&Value>) -> Vec<String> {
    let tags = match value {
        Some(Value::Array(values)) => values.iter().map(|item| value_to_string(Some(item))).collect::<Vec<_>>(),
        Some(Value::String(value)) => value
            .split([',', '，', '\n'])
            .map(str::to_string)
            .collect::<Vec<_>>(),
        Some(other) => vec![value_to_string(Some(other))],
        None => Vec::new(),
    };

    tags.into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .take(8)
        .collect()
}

fn normalize_repositories(value: Option<&Value>) -> Vec<RepositoryDraft> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| item.as_object())
        .map(|repo| RepositoryDraft {
            name: value_to_string(repo.get("name")),
            repository_type: normalize_repository_type(repo.get("type")),
            url_or_path: value_to_string(repo.get("urlOrPath").or_else(|| repo.get("url_or_path"))),
            note: value_to_string(repo.get("note")),
        })
        .collect()
}

fn normalize_todos(value: Option<&Value>) -> Vec<TodoDraft> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(normalize_todo_item).collect(),
        Some(Value::String(text)) => split_text_todos(text),
        Some(other) => normalize_todo_item(other).into_iter().collect(),
        None => Vec::new(),
    }
}

fn normalize_todo_response(raw: Value) -> Vec<TodoDraft> {
    match raw {
        Value::Array(items) => items.iter().filter_map(normalize_todo_item).take(12).collect(),
        Value::Object(object) => normalize_todos(object.get("todos")).into_iter().take(12).collect(),
        Value::String(text) => split_text_todos(&text).into_iter().take(12).collect(),
        _ => Vec::new(),
    }
}

fn normalize_todo_item(item: &Value) -> Option<TodoDraft> {
    match item {
        Value::String(title) => {
            let title = title.trim();
            if title.is_empty() {
                None
            } else {
                Some(TodoDraft {
                    title: title.to_string(),
                    description: None,
                    status: Some(TodoStatus::Todo),
                    priority: Some(Priority::Medium),
                    due_date: None,
                    tags: Vec::new(),
                })
            }
        }
        Value::Array(values) => {
            let title = values.iter().map(|value| value_to_string(Some(value))).collect::<Vec<_>>().join(" ");
            normalize_todo_item(&Value::String(title))
        }
        Value::Object(todo) => {
            let title = value_to_string(todo.get("title")).trim().to_string();
            if title.is_empty() {
                return None;
            }
            Some(TodoDraft {
                title,
                description: non_empty_string(todo.get("description")),
                status: Some(normalize_todo_status(todo.get("status"))),
                priority: Some(normalize_priority(todo.get("priority"))),
                due_date: normalize_target_date(todo.get("dueDate").or_else(|| todo.get("due_date"))),
                tags: normalize_tags(todo.get("tags")),
            })
        }
        _ => None,
    }
}

fn split_text_todos(text: &str) -> Vec<TodoDraft> {
    text.lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == '-' || ch == '*' || ch == ' ')
                .trim()
        })
        .filter(|line| !line.is_empty())
        .map(|title| TodoDraft {
            title: title.to_string(),
            description: None,
            status: Some(TodoStatus::Todo),
            priority: Some(Priority::Medium),
            due_date: None,
            tags: Vec::new(),
        })
        .collect()
}

fn normalize_status(value: Option<&Value>) -> IdeaStatus {
    match value_to_string(value).trim() {
        "in_progress" => IdeaStatus::InProgress,
        "completed" => IdeaStatus::Completed,
        "abandoned" => IdeaStatus::Abandoned,
        _ => IdeaStatus::NotStarted,
    }
}

fn normalize_priority(value: Option<&Value>) -> Priority {
    match value_to_string(value).trim() {
        "low" => Priority::Low,
        "high" => Priority::High,
        _ => Priority::Medium,
    }
}

fn normalize_todo_status(value: Option<&Value>) -> TodoStatus {
    match value_to_string(value).trim() {
        "in_progress" => TodoStatus::InProgress,
        "done" => TodoStatus::Done,
        "cancelled" => TodoStatus::Cancelled,
        _ => TodoStatus::Todo,
    }
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    let text = value_to_string(value).trim().to_string();
    if text.is_empty() || text == "null" {
        None
    } else {
        Some(text)
    }
}

fn normalize_repository_type(value: Option<&Value>) -> RepositoryType {
    match value_to_string(value).trim() {
        "local_folder" => RepositoryType::LocalFolder,
        "local_file" => RepositoryType::LocalFile,
        "github" => RepositoryType::Github,
        "overleaf" => RepositoryType::Overleaf,
        "pdf" => RepositoryType::Pdf,
        "dataset" => RepositoryType::Dataset,
        _ => RepositoryType::Other,
    }
}

fn normalize_target_date(value: Option<&Value>) -> Option<String> {
    let date = value_to_string(value).trim().to_string();
    if date.is_empty() || date == "null" {
        None
    } else {
        Some(date)
    }
}

fn normalize_progress(value: Option<&Value>) -> u8 {
    match value {
        Some(Value::Number(number)) => number.as_u64().unwrap_or(0).min(100) as u8,
        Some(Value::String(value)) => value.trim().parse::<u8>().unwrap_or(0).min(100),
        _ => 0,
    }
}

fn extract_json_object(text: &str) -> Option<&str> {
    extract_json_value(text).filter(|value| value.trim_start().starts_with('{'))
}

fn extract_json_value(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    if (trimmed.starts_with('{') && trimmed.ends_with('}')) || (trimmed.starts_with('[') && trimmed.ends_with(']')) {
        return Some(trimmed);
    }

    let object_start = trimmed.find('{');
    let array_start = trimmed.find('[');
    let start = match (object_start, array_start) {
        (Some(object), Some(array)) => object.min(array),
        (Some(object), None) => object,
        (None, Some(array)) => array,
        (None, None) => return None,
    };
    let end = if trimmed[start..].starts_with('{') {
        trimmed.rfind('}')?
    } else {
        trimmed.rfind(']')?
    };
    if start < end {
        Some(&trimmed[start..=end])
    } else {
        None
    }
}

fn validate_base_settings(config: &LlmConfig, require_model: bool) -> Result<(), String> {
    if provider_kind(&config.provider).is_empty() {
        return Err("请选择 Provider。".to_string());
    }
    if config.base_url.trim().is_empty() {
        return Err("请填写 Base URL。".to_string());
    }
    if config.api_key.trim().is_empty() {
        return Err(MISSING_API_KEY_MESSAGE.to_string());
    }
    if require_model && config.model.trim().is_empty() {
        return Err("请填写或选择 Model。".to_string());
    }
    Ok(())
}

fn provider_kind(provider: &str) -> String {
    match provider {
        "openai" => "openai".to_string(),
        "anthropic" => "anthropic".to_string(),
        "openai-compatible" | "openai_compatible" | "local" | "custom" => "openai-compatible".to_string(),
        _ => String::new(),
    }
}

fn test_result(
    config: &LlmConfig,
    ok: bool,
    message: impl Into<String>,
    status_code: Option<u16>,
    raw_error: Option<String>,
) -> TestConnectionResult {
    TestConnectionResult {
        ok,
        provider: provider_kind(&config.provider),
        base_url: config.base_url.trim().to_string(),
        model: config.model.trim().to_string(),
        message: message.into(),
        status_code,
        raw_error,
    }
}

fn join_endpoint(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim().trim_end_matches('/'), path.trim_start_matches('/'))
}

fn anthropic_messages_endpoint(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    if base.ends_with("/v1") {
        format!("{}/messages", base)
    } else {
        format!("{}/v1/messages", base)
    }
}

fn anthropic_model_presets() -> Vec<String> {
    vec![
        "claude-3-5-sonnet-latest".to_string(),
        "claude-3-5-haiku-latest".to_string(),
        "claude-3-opus-latest".to_string(),
    ]
}

fn open_path_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(path)
            .status()
            .map_err(|error| format!("Failed to open path: {}", error))?;
        return command_status_to_result(status, "Failed to open path.");
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg(path)
            .status()
            .map_err(|error| format!("Failed to open path: {}", error))?;
        return command_status_to_result(status, "Failed to open path.");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|error| format!("Failed to open path: {}", error))?;
        return command_status_to_result(status, "Failed to open path.");
    }

    #[allow(unreachable_code)]
    Err("Opening local paths is not supported on this platform.".to_string())
}

fn reveal_path_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .status()
            .map_err(|error| format!("Failed to reveal path: {}", error))?;
        return command_status_to_result(status, "Failed to reveal path.");
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|error| format!("Failed to reveal path: {}", error))?;
        return command_status_to_result(status, "Failed to reveal path.");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
        let status = Command::new("xdg-open")
            .arg(target)
            .status()
            .map_err(|error| format!("Failed to reveal path: {}", error))?;
        return command_status_to_result(status, "Failed to reveal path.");
    }

    #[allow(unreachable_code)]
    Err("Revealing local paths is not supported on this platform.".to_string())
}

fn command_status_to_result(status: std::process::ExitStatus, error_message: &str) -> Result<(), String> {
    if status.success() {
        Ok(())
    } else {
        Err(error_message.to_string())
    }
}

fn idea_system_prompt() -> &'static str {
    r##"你是科研 idea 整理助手。必须只输出一个严格 JSON 对象，不要 markdown code block，不要解释文字。
字段类型必须完全一致：
{
  "title": "string",
  "content": "string",
  "plan": "string",
  "todos": [
    {
      "title": "string",
      "description": "string",
      "status": "todo | in_progress | done | cancelled",
      "priority": "low | medium | high",
      "dueDate": null,
      "tags": []
    }
  ],
  "repositories": [],
  "status": "not_started | in_progress | completed | abandoned",
  "tags": [],
  "priority": "low | medium | high",
  "progress": 0,
  "notes": "string"
}
类型规则：
1. title 必须是 string，不要数组。
2. content 必须是 string，不要数组。
3. plan 必须是 string，不要数组。如果有多步计划，用 Markdown 编号列表字符串，例如 "1. 文献调研\n2. 数据收集\n3. 模型验证"。
4. notes 必须是 string，不要数组。
5. tags 必须是 string array，控制在 3-8 个。
6. repositories 必须是 array；repositories[].type 只能是 local_folder, local_file, github, overleaf, pdf, dataset, other。
7. todos 必须是 array，给 3-8 个可执行任务；todo.status 只能是 todo, in_progress, done, cancelled；todo.priority 只能是 low, medium, high；dueDate 可以是 string 或 null。
8. todos 是执行任务，不要写成泛泛的研究方向；plan 是研究路线说明，可以更宏观。
9. progress 必须是 number，默认 0。
10. status 默认 not_started，除非用户明确表示已经开始。
11. priority 默认 medium。
content 要包含研究背景、核心问题、可能创新点、技术路线；plan 要给研究路线；todos 给可直接执行和勾选的任务；notes 写风险、假设或待确认问题。"##
}

fn project_todo_system_prompt() -> &'static str {
    r##"You generate executable Project Todo items for a research idea. Output only a strict JSON object:
{
  "todos": [
    {
      "title": "string",
      "description": "string",
      "status": "todo",
      "priority": "low | medium | high",
      "dueDate": null,
      "tags": []
    }
  ]
}
Rules:
1. Return 3-8 concrete tasks that can be checked off.
2. status must be todo unless the user explicitly says a task is already active or done.
3. priority must be low, medium, or high.
4. dueDate can be string or null.
5. tags must be an array of short strings.
6. Do not include research idea fields such as content, plan, repositories, hypotheses, or novelty in the JSON root."##
}

fn daily_todo_system_prompt() -> &'static str {
    r##"You organize general daily tasks. Output only a strict JSON object:
{
  "todos": [
    {
      "title": "string",
      "description": "string",
      "status": "todo",
      "priority": "low | medium | high",
      "dueDate": null,
      "tags": []
    }
  ]
}
Rules:
1. Return practical daily tasks, not research idea summaries.
2. Keep titles short and executable.
3. Use tags for categories such as work, study, health, errand, home, or custom terms from the user.
4. status must be todo unless the user explicitly says a task is active or done.
5. Do not include content, plan, repositories, hypotheses, innovation, or literature-route fields."##
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fetch_llm_models,
            test_llm_connection,
            generate_idea_with_ai,
            organize_idea_with_ai,
            modify_idea_with_ai,
            generate_project_todos_with_ai,
            generate_daily_todos_with_ai,
            path_exists,
            open_local_path,
            reveal_in_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEW IDEAS");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_plan_and_notes_arrays() {
        let raw = json!({
            "title": "传感器噪声对转轮除湿模型辨识的影响",
            "content": "研究传感器噪声对模型辨识稳定性的影响。",
            "plan": ["文献调研", "建立噪声模型", "使用 UKF 进行估计", "实验验证"],
            "repositories": [],
            "status": "not_started",
            "tags": ["转轮除湿", "UKF", "数据同化"],
            "priority": "medium",
            "progress": 0,
            "notes": ["需要确认传感器采样频率", "需要真实运行数据"]
        });

        let draft = normalize_idea_draft(raw).expect("sample 1 should normalize");
        assert_eq!(draft.plan, "文献调研\n建立噪声模型\n使用 UKF 进行估计\n实验验证");
        assert_eq!(draft.notes.as_deref(), Some("需要确认传感器采样频率\n需要真实运行数据"));
        assert_eq!(draft.tags, vec!["转轮除湿", "UKF", "数据同化"]);
        assert_eq!(draft.progress, Some(0));
    }

    #[test]
    fn normalizes_tags_string_content_array_and_progress_string() {
        let raw = json!({
            "title": "转轮除湿数据同化",
            "content": ["研究背景", "核心问题", "创新点"],
            "plan": "1. 调研\n2. 建模\n3. 验证",
            "repositories": [],
            "status": "in_progress",
            "tags": "转轮除湿, UKF, 粒子滤波",
            "priority": "high",
            "progress": "0",
            "notes": ""
        });

        let draft = normalize_idea_draft(raw).expect("sample 2 should normalize");
        assert_eq!(draft.content, "研究背景\n核心问题\n创新点");
        assert_eq!(draft.tags, vec!["转轮除湿", "UKF", "粒子滤波"]);
        assert!(matches!(draft.status, IdeaStatus::InProgress));
        assert!(matches!(draft.priority, Priority::High));
        assert_eq!(draft.progress, Some(0));
    }

    #[test]
    fn normalizes_ai_generated_todos() {
        let raw = json!({
            "title": "转轮除湿实验计划",
            "content": "研究实验工况对模型辨识的影响。",
            "plan": "1. 设计工况\n2. 采集数据\n3. 验证模型",
            "todos": [
                {
                    "title": "整理 10 篇相关论文",
                    "description": "记录模型、数据和实验工况。",
                    "status": "done",
                    "priority": "high",
                    "dueDate": null
                },
                {
                    "title": "搭建数据清洗脚本",
                    "status": "unknown",
                    "priority": "unknown",
                    "due_date": "2026-06-01"
                }
            ],
            "repositories": [],
            "status": "not_started",
            "tags": ["转轮除湿", "实验"],
            "priority": "medium",
            "progress": 0,
            "notes": ""
        });

        let draft = normalize_idea_draft(raw).expect("todos should normalize");
        assert_eq!(draft.todos.len(), 2);
        assert!(matches!(draft.todos[0].status, Some(TodoStatus::Done)));
        assert!(matches!(draft.todos[0].priority, Some(Priority::High)));
        assert!(matches!(draft.todos[1].status, Some(TodoStatus::Todo)));
        assert!(matches!(draft.todos[1].priority, Some(Priority::Medium)));
        assert_eq!(draft.todos[1].due_date.as_deref(), Some("2026-06-01"));
    }
}
