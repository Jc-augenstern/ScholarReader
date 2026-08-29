use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::{database::AppState, error::AppError, models::AppSettings};

const SETTINGS_KEY: &str = "app.preferences.v1";

#[tauri::command]
pub async fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, AppError> {
    let value: Option<String> = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?")
        .bind(SETTINGS_KEY)
        .fetch_optional(&state.pool)
        .await?;
    value
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| AppError::Database(sqlx::Error::Decode(Box::new(error))))
        .map(|value| value.unwrap_or_default())
}

#[tauri::command]
pub async fn save_app_settings(
    input: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, AppError> {
    if !matches!(input.theme.as_str(), "system" | "light" | "dark") {
        return Err(AppError::InvalidInput("unsupported theme".into()));
    }
    if !(80..=150).contains(&input.ui_scale) || input.ui_scale % 5 != 0 {
        return Err(AppError::InvalidInput(
            "UI scale must be 80-150 in 5% steps".into(),
        ));
    }
    if !(90..=130).contains(&input.font_scale) || input.font_scale % 10 != 0 {
        return Err(AppError::InvalidInput(
            "font scale must be 90-130 in 10% steps".into(),
        ));
    }
    if !matches!(
        input.accent.as_str(),
        "green" | "blue" | "cyan" | "purple" | "orange" | "red" | "pink"
    ) {
        return Err(AppError::InvalidInput("unsupported accent color".into()));
    }
    let value_json =
        serde_json::to_string(&input).map_err(|error| AppError::InvalidInput(error.to_string()))?;
    sqlx::query(
        r#"
        INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
        "#,
    )
    .bind(SETTINGS_KEY)
    .bind(value_json)
    .bind(now_ms())
    .execute(&state.pool)
    .await?;
    Ok(input)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_follows_the_system() {
        let settings = AppSettings::default();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.ui_scale, 100);
        assert_eq!(settings.font_scale, 100);
        assert_eq!(settings.accent, "green");
    }

    #[test]
    fn legacy_settings_json_uses_display_defaults() {
        let settings: AppSettings = serde_json::from_str(r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.ui_scale, 100);
        assert_eq!(settings.font_scale, 100);
        assert_eq!(settings.accent, "green");
    }
}
