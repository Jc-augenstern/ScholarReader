use tauri::{path::BaseDirectory, AppHandle, Manager, State};

use crate::{
    ai::{config, manifest::RUNTIME_ARCHIVE_NAME},
    database::AppState,
    error::AppError,
    models::{AiSettings, ManagedAiAssessment, ManagedAiStatus},
};

#[tauri::command]
pub async fn assess_managed_ai(
    state: State<'_, AppState>,
) -> Result<ManagedAiAssessment, AppError> {
    state.managed_ai.assess().await
}

#[tauri::command]
pub async fn get_managed_ai_status(
    state: State<'_, AppState>,
) -> Result<ManagedAiStatus, AppError> {
    Ok(state.managed_ai.status().await)
}

#[tauri::command]
pub async fn prepare_managed_ai(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ManagedAiStatus, AppError> {
    let archive = app
        .path()
        .resolve(
            format!("managed-ai/{RUNTIME_ARCHIVE_NAME}"),
            BaseDirectory::Resource,
        )
        .map_err(|error| {
            AppError::Platform(format!("managed runtime resource unavailable: {error}"))
        })?;
    let status = state.managed_ai.prepare(&app, &archive).await?;
    if status.state == "ready" {
        let settings = config::activate_managed(&state.pool, &status.model_id).await?;
        let provider = state.managed_ai.provider_state(&settings, true).await;
        if provider.status != "ready" {
            return Err(AppError::Ai(
                provider
                    .technical_details
                    .unwrap_or_else(|| provider.message.clone()),
            ));
        }
    }
    Ok(status)
}

#[tauri::command]
pub async fn pause_managed_ai_setup(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(state.managed_ai.pause_setup().await)
}

#[tauri::command]
pub async fn cancel_managed_ai_setup(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(state.managed_ai.cancel_setup().await)
}

#[tauri::command]
pub async fn delete_managed_ai_models(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ManagedAiStatus, AppError> {
    let status = state.managed_ai.delete_models(&app).await?;
    let settings = config::disable_managed(&state.pool).await?;
    state.managed_ai.provider_state(&settings, false).await;
    Ok(status)
}

#[tauri::command]
pub async fn restart_managed_ai(state: State<'_, AppState>) -> Result<bool, AppError> {
    let settings = managed_settings(&state).await?;
    state.managed_ai.restart(&settings.model).await
}

#[tauri::command]
pub async fn test_managed_ai(state: State<'_, AppState>) -> Result<bool, AppError> {
    let settings = managed_settings(&state).await?;
    state.managed_ai.test(&settings.model).await
}

async fn managed_settings(state: &AppState) -> Result<AiSettings, AppError> {
    let settings = config::load_settings(&state.pool).await?;
    if settings.provider != "managed-local" {
        return Err(AppError::Ai("本地 AI 尚未启用".into()));
    }
    Ok(settings)
}
