use tauri::{Manager, State};

use crate::{database::AppState, error::AppError, models::DatabaseStatus};

#[tauri::command]
pub async fn database_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DatabaseStatus, AppError> {
    let schema_version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&state.pool)
        .await?;
    let database_path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| AppError::InvalidInput(error.to_string()))?
        .join("scholar-reader.db")
        .to_string_lossy()
        .into_owned();

    Ok(DatabaseStatus {
        ready: true,
        schema_version,
        database_path,
    })
}
