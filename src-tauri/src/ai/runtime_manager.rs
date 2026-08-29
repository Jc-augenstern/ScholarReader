use std::{
    fs::OpenOptions,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use reqwest::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{process::Child, sync::Mutex, time::sleep};
use uuid::Uuid;

use crate::{
    ai::manifest::{ModelManifest, RUNTIME_ARCHIVE_SHA256, RUNTIME_ARCHIVE_SIZE, RUNTIME_VERSION},
    diagnostics,
    error::AppError,
};

const IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone)]
pub struct RuntimeEndpoint {
    pub base_url: String,
    pub api_key: String,
}

struct RuntimeProcess {
    child: Child,
    endpoint: RuntimeEndpoint,
    model_id: String,
    last_used: Instant,
}

pub struct LocalRuntimeManager {
    root: PathBuf,
    runtime_dir: PathBuf,
    logs_dir: PathBuf,
    process: Mutex<Option<RuntimeProcess>>,
    client: Client,
}

impl LocalRuntimeManager {
    pub fn new(root: &Path) -> Result<Self, AppError> {
        let manager = Self {
            root: root.to_path_buf(),
            runtime_dir: root.join("runtime").join(RUNTIME_VERSION),
            logs_dir: root.join("logs"),
            process: Mutex::new(None),
            client: Client::builder()
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(180))
                .user_agent("ScholarReader/0.2 ManagedLocalAI")
                .build()
                .map_err(|error| {
                    AppError::Ai(format!("could not initialize local AI client: {error}"))
                })?,
        };
        diagnostics::info(
            "managed_runtime_initialized",
            json!({
                "runtimePath": manager.runtime_dir.to_string_lossy(),
                "runtimeVersion": RUNTIME_VERSION,
                "runtimeFileExists": manager.runtime_dir.join(runtime_executable_name()).is_file(),
            }),
        );
        Ok(manager)
    }

    pub async fn is_installed(&self) -> bool {
        self.runtime_dir.join(runtime_executable_name()).is_file()
            && self.runtime_dir.join(".installed").is_file()
    }

    pub async fn install_from_archive(&self, archive: &Path) -> Result<(), AppError> {
        if self.is_installed().await {
            diagnostics::info(
                "managed_runtime_install_skipped",
                json!({"reason": "already-installed"}),
            );
            return Ok(());
        }
        diagnostics::info(
            "managed_runtime_install_started",
            json!({"archivePath": archive.to_string_lossy(), "runtimePath": self.runtime_dir.to_string_lossy()}),
        );
        let archive = archive.to_path_buf();
        let destination = self.runtime_dir.clone();
        tokio::task::spawn_blocking(move || extract_verified_runtime(&archive, &destination))
            .await
            .map_err(|error| {
                AppError::Platform(format!("runtime extraction task failed: {error}"))
            })??;
        diagnostics::info(
            "managed_runtime_install_succeeded",
            json!({"runtimeVersion": RUNTIME_VERSION, "sha256Verified": true}),
        );
        Ok(())
    }

    pub async fn is_running(&self) -> bool {
        let mut process = self.process.lock().await;
        match process.as_mut() {
            Some(runtime) => match runtime.child.try_wait() {
                Ok(None) => true,
                _ => {
                    *process = None;
                    false
                }
            },
            None => false,
        }
    }

    pub async fn ensure_running(
        &self,
        manifest: &ModelManifest,
        model_path: &Path,
    ) -> Result<RuntimeEndpoint, AppError> {
        let mut process = self.process.lock().await;
        if let Some(runtime) = process.as_mut() {
            if runtime.child.try_wait()?.is_none() && runtime.model_id == manifest.id {
                runtime.last_used = Instant::now();
                return Ok(runtime.endpoint.clone());
            }
            let _ = runtime.child.start_kill();
            *process = None;
        }

        if !self.is_installed().await {
            return Err(AppError::Ai("本地 AI 运行组件尚未安装".into()));
        }
        if !model_path.is_file() {
            return Err(AppError::Ai("本地 AI 模型尚未安装".into()));
        }
        tokio::fs::create_dir_all(&self.logs_dir).await?;
        let port = reserve_loopback_port()?;
        let api_key = Uuid::new_v4().to_string();
        let key_path = self.root.join("runtime-api-key.txt");
        tokio::fs::write(&key_path, format!("{api_key}\n")).await?;
        let log_path = self.logs_dir.join("llama-server.log");
        rotate_runtime_log(&log_path);
        let stdout = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;
        let stderr = stdout.try_clone()?;
        let thread_count = std::thread::available_parallelism()
            .map(|value| value.get().saturating_sub(2).max(2))
            .unwrap_or(4);
        let executable = self.runtime_dir.join(runtime_executable_name());
        diagnostics::info(
            "managed_runtime_starting",
            json!({
                "runtimePath": executable.to_string_lossy(),
                "runtimeFileExists": executable.is_file(),
                "modelPath": model_path.to_string_lossy(),
                "modelFileExists": model_path.is_file(),
                "modelId": manifest.id,
                "modelSize": manifest.size,
                "stdoutPath": log_path.to_string_lossy(),
                "stderrPath": log_path.to_string_lossy(),
            }),
        );
        let mut command = tokio::process::Command::new(&executable);
        command
            .current_dir(&self.runtime_dir)
            .arg("--model")
            .arg(model_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ctx-size")
            .arg("4096")
            .arg("--threads")
            .arg(thread_count.to_string())
            .arg("--threads-batch")
            .arg(thread_count.to_string())
            .arg("--parallel")
            .arg("1")
            .arg("--jinja")
            .arg("--reasoning")
            .arg("off")
            .arg("--no-webui")
            .arg("--api-key-file")
            .arg(&key_path)
            .arg("--log-file")
            .arg(&log_path)
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .kill_on_drop(true);
        #[cfg(target_os = "windows")]
        command.creation_flags(0x0800_0000);
        let child = command
            .spawn()
            .map_err(|error| AppError::Ai(format!("无法启动本地 AI：{error}")))?;
        diagnostics::info(
            "managed_runtime_started",
            json!({"pid": child.id(), "modelId": manifest.id, "port": port}),
        );
        let endpoint = RuntimeEndpoint {
            base_url: format!("http://127.0.0.1:{port}/v1"),
            api_key,
        };
        let mut runtime = RuntimeProcess {
            child,
            endpoint: endpoint.clone(),
            model_id: manifest.id.into(),
            last_used: Instant::now(),
        };
        self.wait_until_ready(&mut runtime).await?;
        *process = Some(runtime);
        Ok(endpoint)
    }

    pub async fn complete(
        &self,
        manifest: &ModelManifest,
        model_path: &Path,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, AppError> {
        let mut last_error = None;
        for attempt in 0..2 {
            let endpoint = self.ensure_running(manifest, model_path).await?;
            match self.request_completion(&endpoint, prompt, max_tokens).await {
                Ok(content) => {
                    if let Some(runtime) = self.process.lock().await.as_mut() {
                        runtime.last_used = Instant::now();
                    }
                    return Ok(content);
                }
                Err(error) => {
                    last_error = Some(error);
                    if attempt == 0 {
                        self.stop().await;
                    }
                }
            }
        }
        Err(last_error.unwrap_or_else(|| AppError::Ai("本地 AI 暂时无法使用".into())))
    }

    pub async fn stop(&self) {
        if let Some(mut runtime) = self.process.lock().await.take() {
            let pid = runtime.child.id();
            let _ = runtime.child.start_kill();
            let status = runtime.child.wait().await.ok();
            diagnostics::info(
                "managed_runtime_stopped",
                json!({"pid": pid, "exitCode": status.and_then(|value| value.code())}),
            );
        }
    }

    pub fn stop_blocking(&self) {
        if let Some(mut runtime) = self.process.blocking_lock().take() {
            let _ = runtime.child.start_kill();
        }
    }

    pub async fn stop_if_idle(&self) {
        let should_stop = self
            .process
            .lock()
            .await
            .as_ref()
            .is_some_and(|runtime| runtime.last_used.elapsed() >= IDLE_TIMEOUT);
        if should_stop {
            self.stop().await;
        }
    }

    async fn wait_until_ready(&self, runtime: &mut RuntimeProcess) -> Result<(), AppError> {
        let health_url = runtime.endpoint.base_url.trim_end_matches("/v1").to_owned() + "/health";
        diagnostics::info(
            "managed_runtime_health_check_started",
            json!({"pid": runtime.child.id(), "modelId": runtime.model_id}),
        );
        for _ in 0..180 {
            if let Some(status) = runtime.child.try_wait()? {
                diagnostics::error(
                    "managed_runtime_exited",
                    json!({"pid": runtime.child.id(), "exitCode": status.code(), "status": status.to_string()}),
                );
                return Err(AppError::Ai(format!(
                    "本地 AI 启动失败（进程退出码 {status}）"
                )));
            }
            if let Ok(response) = self
                .client
                .get(&health_url)
                .bearer_auth(&runtime.endpoint.api_key)
                .send()
                .await
            {
                if response.status().is_success() {
                    diagnostics::info(
                        "managed_runtime_health_check_succeeded",
                        json!({"pid": runtime.child.id(), "modelId": runtime.model_id}),
                    );
                    return Ok(());
                }
            }
            sleep(Duration::from_secs(1)).await;
        }
        let _ = runtime.child.start_kill();
        diagnostics::error(
            "managed_runtime_health_check_failed",
            json!({"pid": runtime.child.id(), "reason": "timeout"}),
        );
        Err(AppError::Ai("本地 AI 启动超时".into()))
    }

    async fn request_completion(
        &self,
        endpoint: &RuntimeEndpoint,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, AppError> {
        let response = self
            .client
            .post(format!("{}/chat/completions", endpoint.base_url))
            .bearer_auth(&endpoint.api_key)
            .json(&json!({
                "model": "local",
                "messages": [
                    {"role": "system", "content": "You are ScholarReader's concise academic reading assistant. Follow the requested output language, use only the supplied text, and never reveal chain-of-thought."},
                    {"role": "user", "content": format!("/no_think\n{prompt}")}
                ],
                "temperature": 0.3,
                "top_p": 0.8,
                "max_tokens": max_tokens,
                "stream": false
            }))
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    AppError::Ai("本地 AI 响应超时".into())
                } else {
                    AppError::Ai("无法连接本地 AI".into())
                }
            })?;
        if !response.status().is_success() {
            return Err(AppError::Ai(format!(
                "本地 AI 返回 HTTP {}",
                response.status().as_u16()
            )));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|_| AppError::Ai("本地 AI 返回了无法识别的结果".into()))?;
        body.pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|content| !content.is_empty())
            .map(ToOwned::to_owned)
            .ok_or_else(|| AppError::Ai("本地 AI 没有返回内容".into()))
    }
}

fn rotate_runtime_log(path: &Path) {
    const MAX_RUNTIME_LOG_BYTES: u64 = 5 * 1024 * 1024;
    if std::fs::metadata(path).is_ok_and(|metadata| metadata.len() >= MAX_RUNTIME_LOG_BYTES) {
        let rotated = path.with_file_name("llama-server.1.log");
        let _ = std::fs::remove_file(&rotated);
        let _ = std::fs::rename(path, rotated);
    }
}

fn reserve_loopback_port() -> Result<u16, AppError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn runtime_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    }
}

fn extract_verified_runtime(archive: &Path, destination: &Path) -> Result<(), AppError> {
    let metadata = std::fs::metadata(archive)?;
    if metadata.len() != RUNTIME_ARCHIVE_SIZE {
        return Err(AppError::Ai("本地 AI 运行组件大小校验失败".into()));
    }
    let mut source = std::fs::File::open(archive)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if hex::encode(hasher.finalize()) != RUNTIME_ARCHIVE_SHA256 {
        return Err(AppError::Ai("本地 AI 运行组件校验失败".into()));
    }
    diagnostics::info(
        "managed_runtime_sha256_verified",
        json!({"archiveSize": metadata.len(), "runtimeVersion": RUNTIME_VERSION}),
    );
    if destination.exists() {
        std::fs::remove_dir_all(destination)?;
    }
    std::fs::create_dir_all(destination)?;
    let source = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(source)
        .map_err(|error| AppError::Ai(format!("无法读取本地 AI 运行组件：{error}")))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| AppError::Ai(format!("无法解压本地 AI 运行组件：{error}")))?;
        let Some(relative) = entry.enclosed_name() else {
            return Err(AppError::Ai("本地 AI 运行组件包含不安全路径".into()));
        };
        let output = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(output)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::File::create(output)?;
        std::io::copy(&mut entry, &mut file)?;
        file.flush()?;
    }
    std::fs::write(destination.join(".installed"), RUNTIME_VERSION)?;
    Ok(())
}
