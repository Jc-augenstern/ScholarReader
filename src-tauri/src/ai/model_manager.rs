use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use reqwest::{header, Client, StatusCode};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::{fs, io::AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::{ai::manifest::ModelManifest, diagnostics, error::AppError, models::ManagedAiProgress};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallReceipt<'a> {
    model_id: &'a str,
    filename: &'a str,
    size: u64,
    sha256: &'a str,
}

pub struct ModelManager {
    models_dir: PathBuf,
    downloads_dir: PathBuf,
    client: Client,
}

impl ModelManager {
    pub fn new(root: &Path) -> Result<Self, AppError> {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(12))
            .timeout(Duration::from_secs(2 * 60 * 60))
            .user_agent("ScholarReader/0.2 ManagedLocalAI")
            .build()
            .map_err(|error| {
                AppError::Ai(format!("could not initialize model downloader: {error}"))
            })?;
        let manager = Self {
            models_dir: root.join("models"),
            downloads_dir: root.join("downloads"),
            client,
        };
        diagnostics::info(
            "managed_model_manager_initialized",
            serde_json::json!({"modelsPath": manager.models_dir.to_string_lossy()}),
        );
        Ok(manager)
    }

    pub fn model_path(&self, manifest: &ModelManifest) -> PathBuf {
        self.models_dir.join(manifest.filename)
    }

    pub async fn is_installed(&self, manifest: &ModelManifest) -> bool {
        let model = self.model_path(manifest);
        let receipt = self
            .models_dir
            .join(format!("{}.installed.json", manifest.id));
        matches!(fs::metadata(model).await, Ok(metadata) if metadata.len() == manifest.size)
            && receipt.is_file()
    }

    pub async fn partial_size(&self, manifest: &ModelManifest) -> u64 {
        fs::metadata(self.partial_path(manifest))
            .await
            .map(|metadata| metadata.len().min(manifest.size))
            .unwrap_or(0)
    }

    pub async fn install(
        &self,
        manifest: &'static ModelManifest,
        app: &AppHandle,
        cancel: &CancellationToken,
    ) -> Result<PathBuf, AppError> {
        fs::create_dir_all(&self.models_dir).await?;
        fs::create_dir_all(&self.downloads_dir).await?;
        if self.is_installed(manifest).await {
            diagnostics::info(
                "managed_model_install_skipped",
                serde_json::json!({"modelId": manifest.id, "reason": "already-installed"}),
            );
            return Ok(self.model_path(manifest));
        }

        diagnostics::info(
            "managed_model_install_started",
            serde_json::json!({
                "modelId": manifest.id,
                "modelVersion": manifest.id,
                "modelPath": self.model_path(manifest).to_string_lossy(),
                "modelFileExists": self.model_path(manifest).is_file(),
                "modelSize": manifest.size,
                "resumeBytes": self.partial_size(manifest).await,
            }),
        );

        self.download_with_resume(manifest, app, cancel).await?;
        emit_progress(
            app,
            "verifying",
            manifest,
            manifest.size,
            "正在校验 AI 模型",
        );
        let partial = self.partial_path(manifest);
        let actual_hash = hash_file(&partial, cancel).await?;
        if actual_hash != manifest.sha256 {
            let _ = fs::remove_file(&partial).await;
            return Err(AppError::Ai(format!(
                "model checksum mismatch: expected {}, received {actual_hash}",
                manifest.sha256
            )));
        }
        diagnostics::info(
            "managed_model_sha256_verified",
            serde_json::json!({"modelId": manifest.id, "modelSize": manifest.size}),
        );
        let final_path = self.model_path(manifest);
        if final_path.exists() {
            fs::remove_file(&final_path).await?;
        }
        fs::rename(&partial, &final_path).await?;
        self.install_license(manifest).await?;
        let receipt = InstallReceipt {
            model_id: manifest.id,
            filename: manifest.filename,
            size: manifest.size,
            sha256: manifest.sha256,
        };
        fs::write(
            self.models_dir
                .join(format!("{}.installed.json", manifest.id)),
            serde_json::to_vec_pretty(&receipt)
                .map_err(|error| AppError::Ai(format!("could not write model receipt: {error}")))?,
        )
        .await?;
        diagnostics::info(
            "managed_model_install_succeeded",
            serde_json::json!({"modelId": manifest.id, "modelPath": final_path.to_string_lossy(), "modelSize": manifest.size}),
        );
        Ok(final_path)
    }

    pub async fn delete_all(&self) -> Result<(), AppError> {
        if self.models_dir.exists() {
            fs::remove_dir_all(&self.models_dir).await?;
        }
        if self.downloads_dir.exists() {
            fs::remove_dir_all(&self.downloads_dir).await?;
        }
        Ok(())
    }

    pub async fn discard_partial(&self, manifest: &ModelManifest) -> Result<(), AppError> {
        let path = self.partial_path(manifest);
        if path.exists() {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    fn partial_path(&self, manifest: &ModelManifest) -> PathBuf {
        self.downloads_dir
            .join(format!("{}.part", manifest.filename))
    }

    async fn download_with_resume(
        &self,
        manifest: &'static ModelManifest,
        app: &AppHandle,
        cancel: &CancellationToken,
    ) -> Result<(), AppError> {
        let partial = self.partial_path(manifest);
        let existing = self.partial_size(manifest).await;
        if existing == manifest.size {
            return Ok(());
        }
        diagnostics::info(
            if existing > 0 {
                "managed_model_download_resumed"
            } else {
                "managed_model_download_started"
            },
            serde_json::json!({"modelId": manifest.id, "downloadedBytes": existing, "totalBytes": manifest.size}),
        );
        let mut request = self.client.get(manifest.download_url);
        if existing > 0 {
            request = request.header(header::RANGE, format!("bytes={existing}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| friendly_download_error(error, "无法连接模型下载服务"))?;
        let append = existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT;
        if !response.status().is_success() {
            return Err(AppError::Ai(format!(
                "model download returned HTTP {}",
                response.status().as_u16()
            )));
        }
        let mut downloaded = if append { existing } else { 0 };
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)
            .await?;
        let mut stream = response.bytes_stream();
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        emit_progress(
            app,
            "downloading-model",
            manifest,
            downloaded,
            "正在下载 AI 模型",
        );
        while let Some(chunk) = stream.next().await {
            if cancel.is_cancelled() {
                file.flush().await?;
                diagnostics::info(
                    "managed_model_download_interrupted",
                    serde_json::json!({"modelId": manifest.id, "downloadedBytes": downloaded}),
                );
                return Err(AppError::Ai("managed AI setup interrupted".into()));
            }
            let chunk = chunk.map_err(|error| friendly_download_error(error, "AI 模型下载中断"))?;
            file.write_all(&chunk).await?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if last_emit.elapsed() >= Duration::from_millis(200) || downloaded >= manifest.size {
                emit_progress(
                    app,
                    "downloading-model",
                    manifest,
                    downloaded,
                    "正在下载 AI 模型",
                );
                last_emit = Instant::now();
            }
        }
        file.flush().await?;
        if downloaded != manifest.size {
            return Err(AppError::Ai(format!(
                "model download is incomplete: received {downloaded} of {} bytes",
                manifest.size
            )));
        }
        diagnostics::info(
            "managed_model_download_completed",
            serde_json::json!({"modelId": manifest.id, "downloadedBytes": downloaded}),
        );
        Ok(())
    }

    async fn install_license(&self, manifest: &ModelManifest) -> Result<(), AppError> {
        let response = self
            .client
            .get(manifest.license_url)
            .send()
            .await
            .map_err(|error| friendly_download_error(error, "无法下载模型许可证"))?;
        if !response.status().is_success() {
            return Err(AppError::Ai("model license download failed".into()));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| friendly_download_error(error, "模型许可证下载中断"))?;
        let actual = hex::encode(Sha256::digest(&bytes));
        if actual != manifest.license_sha256 {
            return Err(AppError::Ai("model license checksum mismatch".into()));
        }
        fs::write(self.models_dir.join("QWEN3_LICENSE.txt"), bytes).await?;
        Ok(())
    }
}

fn emit_progress(
    app: &AppHandle,
    state: &str,
    manifest: &ModelManifest,
    downloaded: u64,
    message: &str,
) {
    let progress = ManagedAiProgress {
        state: state.into(),
        model_id: manifest.id.into(),
        model_display_name: manifest.display_name.into(),
        downloaded_bytes: downloaded.min(manifest.size),
        total_bytes: manifest.size,
        message: message.into(),
    };
    let _ = app.emit("managed-ai-progress", progress);
}

async fn hash_file(path: &Path, cancel: &CancellationToken) -> Result<String, AppError> {
    let mut file = fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 4 * 1024 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err(AppError::Ai("managed AI setup interrupted".into()));
        }
        let read = tokio::io::AsyncReadExt::read(&mut file, &mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn friendly_download_error(error: reqwest::Error, context: &str) -> AppError {
    if error.is_timeout() {
        AppError::Ai(format!("{context}：连接超时"))
    } else if error.is_connect() {
        AppError::Ai(format!("{context}：网络不可用"))
    } else {
        AppError::Ai(context.into())
    }
}
