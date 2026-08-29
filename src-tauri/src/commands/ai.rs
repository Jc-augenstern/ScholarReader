use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::{
    ai::config,
    database::AppState,
    diagnostics,
    error::AppError,
    models::{AiProviderState, AiRequestInput, AiResponse, AiSettings, SaveAiSettingsInput},
};

#[tauri::command]
pub async fn get_ai_settings(state: State<'_, AppState>) -> Result<AiSettings, AppError> {
    config::load_settings(&state.pool).await
}

#[tauri::command]
pub async fn get_ai_provider_state(
    refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<AiProviderState, AppError> {
    let settings = config::load_settings(&state.pool).await?;
    Ok(state
        .managed_ai
        .provider_state(&settings, refresh.unwrap_or(true))
        .await)
}

#[tauri::command]
pub async fn save_ai_settings(
    input: SaveAiSettingsInput,
    state: State<'_, AppState>,
) -> Result<AiSettings, AppError> {
    let settings = config::save_settings(&state.pool, input).await?;
    state.managed_ai.provider_state(&settings, false).await;
    Ok(settings)
}

#[tauri::command]
pub async fn test_ai_connection(state: State<'_, AppState>) -> Result<bool, AppError> {
    let settings = config::load_settings(&state.pool).await?;
    let provider = state.managed_ai.provider_state(&settings, true).await;
    if provider.status == "ready" {
        Ok(true)
    } else {
        let message = provider
            .technical_details
            .unwrap_or_else(|| provider.message.clone());
        if matches!(provider.status.as_str(), "disabled" | "unconfigured") {
            Err(AppError::AiUnconfigured(message))
        } else {
            Err(AppError::Ai(message))
        }
    }
}

#[tauri::command]
pub async fn run_ai_action(
    input: AiRequestInput,
    state: State<'_, AppState>,
) -> Result<AiResponse, AppError> {
    let text = input.text.trim();
    if text.is_empty() {
        return Err(AppError::InvalidInput(
            "selected text cannot be empty".into(),
        ));
    }
    let selection_length = text.chars().count();
    if selection_length > 32_000 {
        return Err(AppError::InvalidInput(
            "selected text exceeds the 32,000 character limit".into(),
        ));
    }
    if !matches!(input.action.as_str(), "explain" | "translate" | "summarize") {
        return Err(AppError::InvalidInput("unsupported AI action".into()));
    }
    if input.request_id.trim().is_empty() || input.request_id.len() > 100 {
        return Err(AppError::InvalidInput("invalid AI request id".into()));
    }

    let settings = config::load_settings(&state.pool).await?;
    diagnostics::info(
        "ai_action_requested",
        serde_json::json!({
            "requestId": input.request_id,
            "action": input.action,
            "selectionLength": selection_length,
            "contextLength": input.context.as_deref().map(str::chars).map(Iterator::count).unwrap_or(0),
            "provider": settings.provider,
            "model": settings.model,
        }),
    );
    let prompt = build_prompt(
        &input.action,
        text,
        input.context.as_deref(),
        input
            .target_language
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&settings.target_language),
    );
    let token = CancellationToken::new();
    state
        .ai_requests
        .lock()
        .await
        .insert(input.request_id.clone(), token.clone());
    let result = tokio::select! {
        result = state.managed_ai.run_configured(&settings, &prompt) => result,
        _ = token.cancelled() => Err(AppError::Ai("request cancelled".into())),
    };
    state.ai_requests.lock().await.remove(&input.request_id);
    let content = result?;
    Ok(AiResponse {
        content,
        provider: settings.provider,
        model: settings.model,
    })
}

#[tauri::command]
pub async fn cancel_ai_request(
    request_id: String,
    state: State<'_, AppState>,
) -> Result<bool, AppError> {
    let token = state.ai_requests.lock().await.get(&request_id).cloned();
    if let Some(token) = token {
        token.cancel();
        diagnostics::info(
            "ai_action_cancelled",
            serde_json::json!({"requestId": request_id}),
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

fn build_prompt(action: &str, text: &str, context: Option<&str>, language: &str) -> String {
    let instruction = match action {
        "explain" => format!(
            "Explain the following passage in {language} for a university student. Be concise. Preserve English technical terms, and include a simple example only when useful."
        ),
        "translate" => format!(
            "Translate the following passage into {language}. Preserve the original meaning and academic terminology. Do not expand or comment on it."
        ),
        "summarize" => format!(
            "Summarize the following passage in {language}. For longer passages, provide key points and a one-sentence summary; for short passages, use a compact paragraph."
        ),
        _ => unreachable!(),
    };
    let context = context
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\n\nSurrounding context:\n{value}"))
        .unwrap_or_default();
    format!("{instruction}\n\nSelected passage:\n{text}{context}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_keep_actions_separate() {
        let source = "Recognition rather than recall.";
        assert!(build_prompt("translate", source, None, "中文").contains("Translate"));
        assert!(build_prompt("explain", source, Some("HCI"), "中文").contains("HCI"));
        assert!(build_prompt("summarize", source, None, "中文").contains("Summarize"));
    }

    #[test]
    fn legacy_provider_json_remains_compatible() {
        let settings: AiSettings = serde_json::from_str(
            r#"{"provider":"openai","model":"gpt-4.1-mini","baseUrl":"https://api.openai.com/v1","targetLanguage":"中文","hasApiKey":true}"#,
        )
        .expect("legacy AI settings deserialize");
        assert_eq!(settings.provider, "openai");
        assert!(settings.has_api_key);
    }
}
