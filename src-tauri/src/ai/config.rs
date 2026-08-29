use sqlx::SqlitePool;
use url::Url;

use crate::{
    diagnostics,
    error::AppError,
    models::{AiSettings, SaveAiSettingsInput},
};

const SETTINGS_KEY: &str = "ai.config.v1";
const CREDENTIAL_SERVICE: &str = "com.scholarreader.app";
const CREDENTIAL_USER: &str = "ai-api-key";

pub async fn load_settings(pool: &SqlitePool) -> Result<AiSettings, AppError> {
    let value: Option<String> = sqlx::query_scalar("SELECT value_json FROM settings WHERE key = ?")
        .bind(SETTINGS_KEY)
        .fetch_optional(pool)
        .await?;
    let mut settings: AiSettings = value
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| AppError::Database(sqlx::Error::Decode(Box::new(error))))?
        .unwrap_or_default();
    settings.has_api_key = load_api_key().await?.is_some();
    diagnostics::info(
        "ai_config_loaded",
        serde_json::json!({"provider": settings.provider, "apiKeyConfigured": settings.has_api_key}),
    );
    Ok(settings)
}

pub async fn save_settings(
    pool: &SqlitePool,
    input: SaveAiSettingsInput,
) -> Result<AiSettings, AppError> {
    validate_provider(&input.provider)?;
    if input.provider == "managed-local" {
        return Err(AppError::InvalidInput(
            "managed local AI can only be activated after its health check".into(),
        ));
    }
    let base_url = normalize_base_url(&input.provider, &input.base_url)?;
    let model = input.model.trim();
    if input.provider != "disabled" && model.is_empty() {
        return Err(AppError::InvalidInput("model cannot be empty".into()));
    }
    let target_language = input.target_language.trim();
    if target_language.is_empty() || target_language.chars().count() > 40 {
        return Err(AppError::InvalidInput(
            "target language must contain 1 to 40 characters".into(),
        ));
    }
    if input.clear_api_key {
        delete_api_key().await?;
    } else if let Some(key) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        save_api_key(key.to_owned()).await?;
    }
    let settings = AiSettings {
        provider: input.provider,
        model: model.to_owned(),
        base_url,
        target_language: target_language.to_owned(),
        has_api_key: false,
    };
    persist_settings(pool, &settings).await?;
    diagnostics::info(
        "provider_switch_saved",
        serde_json::json!({"provider": settings.provider}),
    );
    load_settings(pool).await
}

pub async fn activate_managed(pool: &SqlitePool, model_id: &str) -> Result<AiSettings, AppError> {
    let current = load_settings(pool).await?;
    let settings = AiSettings {
        provider: "managed-local".into(),
        model: model_id.into(),
        base_url: String::new(),
        target_language: current.target_language,
        has_api_key: false,
    };
    persist_settings(pool, &settings).await?;
    diagnostics::info(
        "provider_switch",
        serde_json::json!({"from": current.provider, "to": "managed-local"}),
    );
    load_settings(pool).await
}

pub async fn disable_managed(pool: &SqlitePool) -> Result<AiSettings, AppError> {
    let current = load_settings(pool).await?;
    if current.provider != "managed-local" {
        return Ok(current);
    }
    let settings = AiSettings {
        provider: "disabled".into(),
        model: current.model,
        base_url: String::new(),
        target_language: current.target_language,
        has_api_key: false,
    };
    persist_settings(pool, &settings).await?;
    diagnostics::info(
        "provider_switch",
        serde_json::json!({"from": "managed-local", "to": "disabled"}),
    );
    load_settings(pool).await
}

pub async fn load_api_key() -> Result<Option<String>, AppError> {
    let result = tauri::async_runtime::spawn_blocking(|| -> Result<Option<String>, AppError> {
        let entry = keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| {
            AppError::Platform(format!("credential store unavailable: {error}"))
        })?;
        match entry.get_password() {
            Ok(value) => Ok((!value.trim().is_empty()).then_some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(AppError::Platform(format!(
                "could not read credential: {error}"
            ))),
        }
    })
    .await
    .map_err(|error| AppError::Platform(format!("credential task failed: {error}")))?;
    match result {
        Ok(result) => {
            diagnostics::info(
                "credential_read_succeeded",
                serde_json::json!({"apiKeyConfigured": result.is_some()}),
            );
            Ok(result)
        }
        Err(error) => {
            diagnostics::error(
                "credential_read_failed",
                serde_json::json!({"apiKeyConfigured": false, "error": error.to_string()}),
            );
            Err(error)
        }
    }
}

async fn save_api_key(api_key: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER)
            .and_then(|entry| entry.set_password(&api_key))
            .map_err(|error| AppError::Platform(format!("could not save credential: {error}")))
    })
    .await
    .map_err(|error| AppError::Platform(format!("credential task failed: {error}")))?
}

async fn delete_api_key() -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let entry = keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| {
            AppError::Platform(format!("credential store unavailable: {error}"))
        })?;
        let _ = entry.delete_credential();
        Ok(())
    })
    .await
    .map_err(|error| AppError::Platform(format!("credential task failed: {error}")))?
}

fn validate_provider(provider: &str) -> Result<(), AppError> {
    if matches!(
        provider,
        "disabled" | "managed-local" | "openai" | "ollama" | "custom"
    ) {
        Ok(())
    } else {
        Err(AppError::InvalidInput("unsupported AI provider".into()))
    }
}

fn normalize_base_url(provider: &str, value: &str) -> Result<String, AppError> {
    if matches!(provider, "disabled" | "managed-local") {
        return Ok(String::new());
    }
    let fallback = match provider {
        "openai" => "https://api.openai.com/v1",
        "ollama" => "http://localhost:11434",
        _ => value.trim(),
    };
    let candidate = if value.trim().is_empty() {
        fallback
    } else {
        value.trim()
    };
    let parsed = Url::parse(candidate)
        .map_err(|_| AppError::InvalidInput("API address must be a valid URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidInput(
            "API address must use http or https".into(),
        ));
    }
    Ok(candidate.trim_end_matches('/').to_owned())
}

async fn persist_settings(pool: &SqlitePool, settings: &AiSettings) -> Result<(), AppError> {
    let value_json = serde_json::to_string(settings)
        .map_err(|error| AppError::InvalidInput(error.to_string()))?;
    sqlx::query(
        r#"INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"#,
    )
    .bind(SETTINGS_KEY)
    .bind(value_json)
    .bind(diagnostics::now_ms())
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_preserves_legacy_providers() {
        assert!(validate_provider("openai").is_ok());
        assert!(validate_provider("ollama").is_ok());
        assert!(validate_provider("custom").is_ok());
        assert!(validate_provider("unknown").is_err());
    }

    #[test]
    fn managed_local_is_not_an_advanced_provider_choice() {
        assert!(validate_provider("managed-local").is_ok());
        assert_eq!(normalize_base_url("managed-local", "ignored").unwrap(), "");
    }
}
