use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    ai::config, database::AppState, diagnostics, error::AppError, models::DiagnosticsSnapshot,
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendErrorReport {
    timestamp: String,
    source: String,
    message: String,
    stack: String,
    component_stack: String,
    route: String,
    app_version: String,
}

impl FrontendErrorReport {
    fn validate(&self) -> Result<(), AppError> {
        for (name, value, limit) in [
            ("timestamp", self.timestamp.as_str(), 100),
            ("source", self.source.as_str(), 200),
            ("message", self.message.as_str(), 16_384),
            ("stack", self.stack.as_str(), 65_536),
            ("componentStack", self.component_stack.as_str(), 65_536),
            ("route", self.route.as_str(), 2_048),
            ("appVersion", self.app_version.as_str(), 100),
        ] {
            if value.len() > limit {
                return Err(AppError::InvalidInput(format!(
                    "frontend error field {name} exceeds {limit} bytes"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendEvent {
    name: String,
    route: String,
    details: serde_json::Value,
}

#[tauri::command]
pub async fn record_frontend_error(report: FrontendErrorReport) -> Result<String, AppError> {
    report.validate()?;
    diagnostics::error(
        "frontend_error",
        serde_json::json!({
            "timestamp": report.timestamp,
            "source": report.source,
            "message": report.message,
            "stack": report.stack,
            "componentStack": report.component_stack,
            "route": report.route,
            "appVersion": report.app_version,
        }),
    );
    Ok(log_path())
}

#[tauri::command]
pub async fn record_frontend_event(event: FrontendEvent) -> Result<(), AppError> {
    if event.name.len() > 200 || event.route.len() > 2_048 {
        return Err(AppError::InvalidInput("frontend event is too large".into()));
    }
    diagnostics::info(
        "frontend_event",
        serde_json::json!({"name": event.name, "route": event.route, "details": event.details}),
    );
    Ok(())
}

#[tauri::command]
pub async fn get_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DiagnosticsSnapshot, AppError> {
    let settings = config::load_settings(&state.pool).await?;
    let provider = state.managed_ai.provider_state(&settings, true).await;
    let database_schema: Option<i64> =
        sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1")
            .fetch_one(&state.pool)
            .await?;
    Ok(DiagnosticsSnapshot {
        version: app.package_info().version.to_string(),
        platform: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        provider: provider.provider,
        provider_status: provider.status,
        model: settings.model,
        model_installed: provider.model_installed,
        runtime_installed: state.managed_ai.runtime_installed().await,
        runtime_running: provider.runtime_running,
        database_schema: database_schema.unwrap_or_default(),
        last_ai_error: state.managed_ai.last_ai_error().await,
        log_directory: diagnostics::directory()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .to_string_lossy()
            .into_owned(),
    })
}

#[tauri::command]
pub async fn open_diagnostics_logs(app: AppHandle) -> Result<(), AppError> {
    let directory = diagnostics::directory()
        .ok_or_else(|| AppError::Platform("diagnostics logger is not initialized".into()))?;
    app.opener()
        .open_path(directory.to_string_lossy(), None::<String>)
        .map_err(|error| AppError::Platform(error.to_string()))
}

#[tauri::command]
pub async fn export_diagnostics_report(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let snapshot = get_diagnostics(app.clone(), state).await?;
    let directory = diagnostics::directory()
        .ok_or_else(|| AppError::Platform("diagnostics logger is not initialized".into()))?;
    let path = directory.join(format!("diagnostics-{}.json", diagnostics::now_ms()));
    let contents = serde_json::to_vec_pretty(&snapshot)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    tokio::fs::write(&path, contents).await?;
    diagnostics::info(
        "diagnostics_exported",
        serde_json::json!({"path": path.to_string_lossy()}),
    );
    Ok(path.to_string_lossy().into_owned())
}

fn log_path() -> String {
    diagnostics::directory()
        .map(|directory| directory.join("scholarreader.log"))
        .unwrap_or_else(|| std::path::PathBuf::from("scholarreader.log"))
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_diagnostic_fields_in_frontend_case() {
        let report = FrontendErrorReport {
            timestamp: "2026-08-24T00:00:00.000Z".into(),
            source: "react.error-boundary".into(),
            message: "boom".into(),
            stack: "stack".into(),
            component_stack: "component".into(),
            route: "/#/reader/one".into(),
            app_version: "0.1.3".into(),
        };
        let json = serde_json::to_value(&report).expect("serializes");
        assert_eq!(json["componentStack"], "component");
        assert_eq!(json["appVersion"], "0.1.3");
        assert!(report.validate().is_ok());
    }
}
