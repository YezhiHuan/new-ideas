use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
struct IdeaDraft {
    title: String,
    content: String,
    plan: String,
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
        "anthropic" => request_anthropic_idea(user_prompt, config).await?,
        "openai" | "openai-compatible" => request_openai_compatible_idea(user_prompt, config).await?,
        _ => return Err("不支持的 Provider。".to_string()),
    };

    parse_idea_draft(&raw_text)
}

async fn request_openai_compatible_idea(user_prompt: String, config: LlmConfig) -> Result<String, String> {
    let endpoint = join_endpoint(&config.base_url, "chat/completions");
    let payload = json!({
        "model": config.model.trim(),
        "messages": [
            { "role": "system", "content": idea_system_prompt() },
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

async fn request_anthropic_idea(user_prompt: String, config: LlmConfig) -> Result<String, String> {
    let endpoint = anthropic_messages_endpoint(&config.base_url);
    let payload = json!({
        "model": config.model.trim(),
        "max_tokens": 1800,
        "temperature": 0.2,
        "system": idea_system_prompt(),
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
    let mut draft: IdeaDraft =
        serde_json::from_str(json_text).map_err(|error| format!("AI 返回 JSON 字段格式不正确：{}", error))?;

    draft.title = draft.title.trim().to_string();
    draft.content = draft.content.trim().to_string();
    draft.plan = draft.plan.trim().to_string();
    draft.tags = draft
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .take(8)
        .collect();
    draft.repositories = draft
        .repositories
        .into_iter()
        .filter(|repo| !repo.name.trim().is_empty() || !repo.url_or_path.trim().is_empty())
        .collect();
    draft.progress = Some(draft.progress.unwrap_or(0).min(100));

    if draft.title.is_empty() || draft.content.is_empty() || draft.plan.is_empty() || draft.tags.is_empty() {
        return Err("AI 返回的 JSON 字段不完整，请重新生成。".to_string());
    }

    Ok(draft)
}

fn extract_json_object(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }

    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
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

fn idea_system_prompt() -> &'static str {
    "你是科研 idea 整理助手。必须只输出一个严格 JSON 对象，不要 Markdown，不要解释。JSON 字段必须为：title, content, plan, repositories, status, tags, priority, targetDate, progress, notes。content 要包含研究背景、核心问题、可能创新点、技术路线；plan 要给可执行步骤；tags 控制在 3-8 个；默认 status 为 not_started，除非用户明确表示已经开始；默认 progress 为 0；priority 默认 medium；repositories 可为空数组；notes 写风险、假设或待确认问题。repositories[].type 只能是 local_folder, local_file, github, overleaf, pdf, dataset, other。"
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
            organize_idea_with_ai
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEW IDEAS");
}
