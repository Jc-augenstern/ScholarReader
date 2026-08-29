use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub title: String,
    pub filename: String,
    pub filepath: String,
    pub file_hash: String,
    pub file_size: i64,
    pub page_count: Option<i64>,
    pub reading_page: Option<i64>,
    pub is_starred: bool,
    pub created_at: i64,
    pub last_opened_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub path: String,
    pub code: String,
    pub message: String,
    pub existing_document_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub imported: Vec<Document>,
    pub duplicates: Vec<ImportIssue>,
    pub failed: Vec<ImportIssue>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    pub ready: bool,
    pub schema_version: i64,
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub document_id: String,
    pub page_number: i64,
    pub page_offset_ratio: f64,
    pub zoom_mode: String,
    pub zoom_value: f64,
    pub rotation: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TagSummary {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub favorite_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub document_id: String,
    pub selected_text: String,
    pub normalized_text: String,
    pub page_number: i64,
    pub text_start_index: Option<i64>,
    pub text_end_index: Option<i64>,
    pub context_before: String,
    pub context_after: String,
    pub selection_rects_json: String,
    pub document_hash: String,
    pub locator_version: i64,
    pub note: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub document_title: String,
    pub filename: String,
    pub filepath: String,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFavoriteInput {
    pub document_id: String,
    pub selected_text: String,
    pub normalized_text: String,
    pub page_number: i64,
    pub text_start_index: Option<i64>,
    pub text_end_index: Option<i64>,
    pub context_before: String,
    pub context_after: String,
    pub selection_rects_json: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFavoriteInput {
    pub id: String,
    pub note: String,
    pub tag_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebindCandidate {
    pub path: String,
    pub filename: String,
    pub file_size: i64,
    pub file_hash: String,
    pub filename_matches: bool,
    pub size_matches: bool,
    pub hash_matches: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub target_language: String,
    pub has_api_key: bool,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: "disabled".into(),
            model: "gpt-4.1-mini".into(),
            base_url: "https://api.openai.com/v1".into(),
            target_language: "中文".into(),
            has_api_key: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAiSettingsInput {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub target_language: String,
    pub api_key: Option<String>,
    pub clear_api_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequestInput {
    pub request_id: String,
    pub action: String,
    pub text: String,
    pub context: Option<String>,
    pub target_language: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub content: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderState {
    pub provider: String,
    pub display_name: String,
    pub status: String,
    pub message: String,
    pub has_api_key: bool,
    pub model_installed: bool,
    pub runtime_running: bool,
    pub last_checked_at: Option<i64>,
    pub technical_details: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub version: String,
    pub platform: String,
    pub provider: String,
    pub provider_status: String,
    pub model: String,
    pub model_installed: bool,
    pub runtime_installed: bool,
    pub runtime_running: bool,
    pub database_schema: i64,
    pub last_ai_error: Option<String>,
    pub log_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiAssessment {
    pub supported: bool,
    pub operating_system: String,
    pub architecture: String,
    pub logical_cpu_count: usize,
    pub total_memory_bytes: u64,
    pub available_disk_bytes: u64,
    pub selected_model_id: String,
    pub selected_model_display_name: String,
    pub model_size_bytes: u64,
    pub downloaded_bytes: u64,
    pub disk_space_sufficient: bool,
    pub installed: bool,
    pub running: bool,
    pub runtime_bundled: bool,
    pub privacy_local: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiProgress {
    pub state: String,
    pub model_id: String,
    pub model_display_name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAiStatus {
    pub state: String,
    pub model_id: String,
    pub model_display_name: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub installed: bool,
    pub running: bool,
    pub message: String,
    pub technical_details: Option<String>,
    pub can_pause: bool,
    pub can_retry: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub theme: String,
    pub ui_scale: u16,
    pub font_scale: u16,
    pub accent: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            ui_scale: 100,
            font_scale: 100,
            accent: "green".into(),
        }
    }
}
