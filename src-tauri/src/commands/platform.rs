use std::path::Path;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{database::AppState, error::AppError};

#[tauri::command]
pub async fn open_document_external(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = document_path(&state, &id).await?;
    ensure_exists(&path)?;
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|error| AppError::Platform(error.to_string()))
}

#[tauri::command]
pub async fn reveal_document_in_manager(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let path = document_path(&state, &id).await?;
    ensure_exists(&path)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| AppError::Platform(error.to_string()))
}

async fn document_path(state: &AppState, id: &str) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT filepath FROM documents WHERE id = ?")
        .bind(id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("document {id}")))
}

fn ensure_exists(path: &str) -> Result<(), AppError> {
    if Path::new(path).is_file() {
        Ok(())
    } else {
        Err(AppError::FileMissing(path.to_owned()))
    }
}
