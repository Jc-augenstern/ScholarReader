use std::time::Duration;

use reqwest::{Client, RequestBuilder};
use serde_json::{json, Value};

use crate::{ai::config, error::AppError, models::AiSettings};

pub async fn probe_remote(settings: &AiSettings) -> Result<(), AppError> {
    let api_key = if matches!(settings.provider.as_str(), "openai" | "custom") {
        config::load_api_key().await?
    } else {
        None
    };
    if settings.provider == "openai" && api_key.is_none() {
        return Err(AppError::AiUnconfigured(
            "OpenAI API key is not configured".into(),
        ));
    }
    probe_remote_with_key(settings, api_key.as_deref()).await
}

async fn probe_remote_with_key(
    settings: &AiSettings,
    api_key: Option<&str>,
) -> Result<(), AppError> {
    if settings.provider == "openai" && api_key.is_none() {
        return Err(AppError::AiUnconfigured(
            "OpenAI API key is not configured".into(),
        ));
    }
    let client = build_client(Duration::from_secs(15))?;
    match settings.provider.as_str() {
        "ollama" => {
            let response = client
                .get(format!("{}/api/tags", settings.base_url))
                .send()
                .await
                .map_err(|error| map_request_error(error, "ollama"))?;
            if !response.status().is_success() {
                return Err(http_error("ollama", response.status().as_u16()));
            }
            let body: Value = response
                .json()
                .await
                .map_err(|_| AppError::Ai("Ollama returned an invalid model list".into()))?;
            let installed = body
                .get("models")
                .and_then(Value::as_array)
                .is_some_and(|models| {
                    models.iter().any(|model| {
                        ["name", "model"]
                            .iter()
                            .filter_map(|key| model.get(key).and_then(Value::as_str))
                            .any(|name| ollama_model_matches(name, &settings.model))
                    })
                });
            if !installed {
                return Err(AppError::Ai(format!(
                    "Ollama model '{}' is not installed",
                    settings.model
                )));
            }
            Ok(())
        }
        "openai" | "custom" => {
            let response = authorize(client.get(format!("{}/models", settings.base_url)), api_key)
                .send()
                .await
                .map_err(|error| map_request_error(error, &settings.provider))?;
            if !response.status().is_success() {
                return Err(http_error(&settings.provider, response.status().as_u16()));
            }
            Ok(())
        }
        _ => Err(AppError::InvalidInput("provider is not remote".into())),
    }
}

pub async fn run_remote(settings: &AiSettings, prompt: &str) -> Result<String, AppError> {
    match settings.provider.as_str() {
        "ollama" => call_ollama(settings, prompt).await,
        "openai" | "custom" => call_openai_compatible(settings, prompt).await,
        _ => Err(AppError::InvalidInput("provider is not remote".into())),
    }
}

fn build_client(timeout: Duration) -> Result<Client, AppError> {
    Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(timeout)
        .user_agent(concat!("ScholarReader/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::Ai(format!("could not initialize HTTP client: {error}")))
}

fn authorize(request: RequestBuilder, api_key: Option<&str>) -> RequestBuilder {
    match api_key {
        Some(key) => request.bearer_auth(key),
        None => request,
    }
}

async fn call_openai_compatible(settings: &AiSettings, prompt: &str) -> Result<String, AppError> {
    let client = build_client(Duration::from_secs(60))?;
    let api_key = config::load_api_key().await?;
    if settings.provider == "openai" && api_key.is_none() {
        return Err(AppError::AiUnconfigured(
            "OpenAI API key is not configured".into(),
        ));
    }
    let response = authorize(
        client.post(format!("{}/chat/completions", settings.base_url)),
        api_key.as_deref(),
    )
    .json(&json!({
        "model": settings.model,
        "messages": [
            {"role": "system", "content": "You are a concise academic reading assistant. Follow the user's requested output language and do not invent facts beyond the supplied text."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    }))
    .send()
    .await
    .map_err(|error| map_request_error(error, &settings.provider))?;
    parse_openai_response(response, &settings.provider).await
}

async fn call_ollama(settings: &AiSettings, prompt: &str) -> Result<String, AppError> {
    let client = build_client(Duration::from_secs(90))?;
    let response = client
        .post(format!("{}/api/chat", settings.base_url))
        .json(&json!({
            "model": settings.model,
            "messages": [
                {"role": "system", "content": "You are a concise academic reading assistant. Follow the user's requested output language and use only the supplied text."},
                {"role": "user", "content": prompt}
            ],
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| map_request_error(error, "ollama"))?;
    if !response.status().is_success() {
        return Err(http_error("ollama", response.status().as_u16()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| AppError::Ai("Ollama returned an invalid response".into()))?;
    extract_content(&body, &["message", "content"])
}

async fn parse_openai_response(
    response: reqwest::Response,
    provider: &str,
) -> Result<String, AppError> {
    if !response.status().is_success() {
        return Err(http_error(provider, response.status().as_u16()));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| AppError::Ai("AI service returned an invalid response".into()))?;
    extract_content(&body, &["choices", "0", "message", "content"])
}

fn extract_content(body: &Value, path: &[&str]) -> Result<String, AppError> {
    let mut current = body;
    for segment in path {
        current = if let Ok(index) = segment.parse::<usize>() {
            current.get(index)
        } else {
            current.get(*segment)
        }
        .ok_or_else(|| AppError::Ai("AI response did not contain output text".into()))?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::Ai("AI response contained empty output".into()))
}

fn ollama_model_matches(installed: &str, configured: &str) -> bool {
    installed == configured
        || installed.strip_suffix(":latest") == Some(configured)
        || configured.strip_suffix(":latest") == Some(installed)
}

fn provider_label(provider: &str) -> &'static str {
    match provider {
        "openai" => "OpenAI",
        "ollama" => "Ollama",
        "custom" => "Custom AI service",
        _ => "AI service",
    }
}

fn http_error(provider: &str, status: u16) -> AppError {
    AppError::Ai(format!(
        "{} returned HTTP {status}",
        provider_label(provider)
    ))
}

fn map_request_error(error: reqwest::Error, provider: &str) -> AppError {
    if error.is_timeout() {
        AppError::Ai(format!("{} request timed out", provider_label(provider)))
    } else if error.is_connect() {
        AppError::Ai(format!("could not connect to {}", provider_label(provider)))
    } else {
        AppError::Ai(format!("{} request failed", provider_label(provider)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn ollama_latest_alias_matches() {
        assert!(ollama_model_matches("qwen3:latest", "qwen3"));
        assert!(ollama_model_matches("qwen3", "qwen3:latest"));
        assert!(!ollama_model_matches("qwen2", "qwen3"));
    }

    #[tokio::test]
    async fn ollama_adapter_reads_non_streaming_chat_output() {
        let (url, server) = mock_json_server(
            r#"{"message":{"role":"assistant","content":"清晰的解释"},"done":true}"#,
        )
        .await;
        let settings = AiSettings {
            provider: "ollama".into(),
            model: "qwen-test".into(),
            base_url: url,
            target_language: "中文".into(),
            has_api_key: false,
        };
        let content = call_ollama(&settings, "Explain this")
            .await
            .expect("Ollama response parses");
        server.await.expect("mock server completes");
        assert_eq!(content, "清晰的解释");
    }

    #[tokio::test]
    async fn openai_health_requires_a_real_successful_http_response() {
        let (url, server) = mock_json_server(r#"{"object":"list","data":[]}"#).await;
        let settings = AiSettings {
            provider: "openai".into(),
            model: "gpt-test".into(),
            base_url: url,
            target_language: "中文".into(),
            has_api_key: true,
        };
        probe_remote_with_key(&settings, Some("unit-test-key"))
            .await
            .expect("successful /models response is healthy");
        server.await.expect("mock server completes");
    }

    #[tokio::test]
    async fn openai_health_without_a_key_stops_before_network() {
        let settings = AiSettings {
            provider: "openai".into(),
            model: "gpt-test".into(),
            base_url: "http://127.0.0.1:1/v1".into(),
            target_language: "中文".into(),
            has_api_key: true,
        };
        assert!(matches!(
            probe_remote_with_key(&settings, None).await,
            Err(AppError::AiUnconfigured(_))
        ));
    }

    #[tokio::test]
    async fn ollama_health_requires_the_configured_model() {
        let (url, server) = mock_json_server(r#"{"models":[{"name":"qwen3:latest"}]}"#).await;
        let settings = AiSettings {
            provider: "ollama".into(),
            model: "qwen3".into(),
            base_url: url,
            target_language: "中文".into(),
            has_api_key: false,
        };
        probe_remote_with_key(&settings, None)
            .await
            .expect("reachable Ollama with configured model is healthy");
        server.await.expect("mock server completes");
    }

    async fn mock_json_server(body: &'static str) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("listener");
        let address = listener.local_addr().expect("address");
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("connection");
            let mut request = vec![0_u8; 4096];
            let _ = stream.read(&mut request).await.expect("request reads");
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .await
                .expect("response writes");
        });
        (format!("http://{address}"), server)
    }
}
