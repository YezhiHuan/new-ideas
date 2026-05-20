use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;

const DEFAULT_OPENAI_MODEL: &str = "gpt-4.1-mini";
const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const MISSING_API_KEY_MESSAGE: &str = "未配置 OpenAI API Key，请先在环境变量或设置页中配置。";

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

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    #[serde(default)]
    output_text: Option<String>,
    #[serde(default)]
    output: Vec<ResponseOutput>,
}

#[derive(Debug, Deserialize)]
struct ResponseOutput {
    #[serde(default)]
    content: Vec<ResponseContent>,
}

#[derive(Debug, Deserialize)]
struct ResponseContent {
    #[serde(default)]
    text: Option<String>,
}

#[tauri::command]
async fn generate_idea_with_ai(input: String) -> Result<IdeaDraft, String> {
    if input.trim().is_empty() {
        return Err("请输入科研 idea 描述后再生成。".to_string());
    }

    let user_prompt = format!(
        "请把下面的自然语言科研想法整理成结构化 IdeaDraft JSON：\n\n{}",
        input.trim()
    );
    request_idea_draft(user_prompt).await
}

#[tauri::command]
async fn organize_idea_with_ai(input: IdeaDraft) -> Result<IdeaDraft, String> {
    let user_prompt = format!(
        "请整理并增强下面这个科研 idea，保持用户已有意图，不要凭空加入已经完成的进展。返回结构化 IdeaDraft JSON。\n\n{}",
        serde_json::to_string_pretty(&input).map_err(|_| "无法序列化当前 idea。")?
    );
    request_idea_draft(user_prompt).await
}

async fn request_idea_draft(user_prompt: String) -> Result<IdeaDraft, String> {
    dotenvy::dotenv().ok();

    let api_key = env::var("OPENAI_API_KEY")
        .map_err(|_| MISSING_API_KEY_MESSAGE.to_string())
        .and_then(|key| {
            let trimmed = key.trim().to_string();
            if trimmed.is_empty() {
                Err(MISSING_API_KEY_MESSAGE.to_string())
            } else {
                Ok(trimmed)
            }
        })?;

    let model = env::var("OPENAI_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_string());
    let base_url = env::var("OPENAI_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_OPENAI_BASE_URL.to_string());
    let endpoint = format!("{}/responses", base_url.trim_end_matches('/'));

    let payload = json!({
        "model": model,
        "input": [
            {
                "role": "system",
                "content": "你是科研 idea 整理助手。必须只输出符合 schema 的 JSON。content 要包含研究背景、核心问题、可能创新点、技术路线；plan 要给可执行步骤；tags 控制在 3-8 个；默认 status 为 not_started，除非用户明确表示已经开始；默认 progress 为 0；priority 默认 medium；repositories 可为空数组；notes 写风险、假设或待确认问题。"
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "research_idea_draft",
                "strict": true,
                "schema": idea_draft_schema()
            }
        }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("AI 请求失败：{}", error))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 AI 响应失败：{}", error))?;

    if status == StatusCode::UNAUTHORIZED {
        return Err("OpenAI API Key 无效或无权限，请检查 OPENAI_API_KEY。".to_string());
    }
    if !status.is_success() {
        return Err(format!("OpenAI 请求失败（{}）：{}", status.as_u16(), body));
    }

    let parsed: OpenAIResponse =
        serde_json::from_str(&body).map_err(|_| "OpenAI 返回了无法解析的响应。".to_string())?;
    let text = extract_response_text(parsed).ok_or_else(|| "OpenAI 返回中没有可用的 JSON 文本。".to_string())?;
    parse_idea_draft(&text)
}

fn extract_response_text(response: OpenAIResponse) -> Option<String> {
    if let Some(text) = response.output_text {
        if !text.trim().is_empty() {
            return Some(text);
        }
    }

    response
        .output
        .into_iter()
        .flat_map(|item| item.content)
        .filter_map(|content| content.text)
        .find(|text| !text.trim().is_empty())
}

fn parse_idea_draft(text: &str) -> Result<IdeaDraft, String> {
    let mut draft: IdeaDraft =
        serde_json::from_str(text).map_err(|_| "OpenAI 返回非 JSON 或字段格式不正确。".to_string())?;

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
        return Err("OpenAI 返回的 JSON 字段不完整，请重新生成。".to_string());
    }

    Ok(draft)
}

fn idea_draft_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "title",
            "content",
            "plan",
            "repositories",
            "status",
            "tags",
            "priority",
            "targetDate",
            "progress",
            "notes"
        ],
        "properties": {
            "title": { "type": "string" },
            "content": { "type": "string" },
            "plan": { "type": "string" },
            "repositories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["name", "type", "urlOrPath", "note"],
                    "properties": {
                        "name": { "type": "string" },
                        "type": {
                            "type": "string",
                            "enum": ["local_folder", "github", "overleaf", "pdf", "dataset", "other"]
                        },
                        "urlOrPath": { "type": "string" },
                        "note": { "type": "string" }
                    }
                }
            },
            "status": {
                "type": "string",
                "enum": ["not_started", "in_progress", "completed", "abandoned"]
            },
            "tags": {
                "type": "array",
                "minItems": 3,
                "maxItems": 8,
                "items": { "type": "string" }
            },
            "priority": {
                "type": "string",
                "enum": ["low", "medium", "high"]
            },
            "targetDate": {
                "type": ["string", "null"],
                "description": "ISO date string like YYYY-MM-DD when a target date is clear, otherwise null."
            },
            "progress": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100
            },
            "notes": { "type": "string" }
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            generate_idea_with_ai,
            organize_idea_with_ai
        ])
        .run(tauri::generate_context!())
        .expect("error while running NEW IDEAS");
}
