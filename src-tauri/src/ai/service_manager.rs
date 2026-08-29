use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicU8, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use crate::{
    ai::{
        manifest::{model_by_id, select_model, ModelManifest, QWEN3_06B},
        model_manager::ModelManager,
        provider::{probe_remote, run_remote},
        runtime_manager::LocalRuntimeManager,
    },
    diagnostics,
    error::AppError,
    models::{AiProviderState, AiSettings, ManagedAiAssessment, ManagedAiStatus},
};

const SETUP_RUNNING: u8 = 0;
const SETUP_PAUSED: u8 = 1;
const SETUP_CANCELLED: u8 = 2;
const DISK_HEADROOM_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone)]
struct SetupControl {
    cancel: CancellationToken,
    action: Arc<AtomicU8>,
}

pub struct AIServiceManager {
    root: PathBuf,
    models: ModelManager,
    runtime: Arc<LocalRuntimeManager>,
    status: RwLock<ManagedAiStatus>,
    provider_state: RwLock<AiProviderState>,
    provider_revision: AtomicU64,
    last_ai_error: RwLock<Option<String>>,
    setup: Mutex<Option<SetupControl>>,
    install_guard: Mutex<()>,
}

impl AIServiceManager {
    pub fn new(root: PathBuf) -> Result<Arc<Self>, AppError> {
        let models = ModelManager::new(&root)?;
        let runtime = Arc::new(LocalRuntimeManager::new(&root)?);
        let manager = Arc::new(Self {
            root,
            models,
            runtime,
            status: RwLock::new(ManagedAiStatus {
                state: "idle".into(),
                model_id: String::new(),
                model_display_name: String::new(),
                downloaded_bytes: 0,
                total_bytes: 0,
                installed: false,
                running: false,
                message: "尚未启用本地 AI".into(),
                technical_details: None,
                can_pause: false,
                can_retry: false,
            }),
            provider_state: RwLock::new(provider_state(
                "disabled",
                "disabled",
                "AI 阅读助手尚未启用",
                false,
                false,
                false,
            )),
            provider_revision: AtomicU64::new(0),
            last_ai_error: RwLock::new(None),
            setup: Mutex::new(None),
            install_guard: Mutex::new(()),
        });
        diagnostics::info(
            "ai_service_manager_initialized",
            serde_json::json!({"managedAiRoot": manager.root.to_string_lossy()}),
        );
        Ok(manager)
    }

    pub fn start_idle_monitor(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                manager.runtime.stop_if_idle().await;
            }
        });
    }

    pub async fn assess(&self) -> Result<ManagedAiAssessment, AppError> {
        tokio::fs::create_dir_all(&self.root).await?;
        let mut system = sysinfo::System::new();
        system.refresh_memory();
        let total_memory = system.total_memory();
        let logical_cpu_count = std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1);
        let manifest = if logical_cpu_count >= 4 {
            select_model(total_memory)
        } else {
            &QWEN3_06B
        };
        let available_disk = fs2::available_space(&self.root)?;
        let downloaded = self.models.partial_size(manifest).await;
        let installed = self.models.is_installed(manifest).await;
        let remaining = manifest.size.saturating_sub(downloaded);

        Ok(ManagedAiAssessment {
            supported: cfg!(all(target_os = "windows", target_arch = "x86_64")),
            operating_system: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            logical_cpu_count,
            total_memory_bytes: total_memory,
            available_disk_bytes: available_disk,
            selected_model_id: manifest.id.into(),
            selected_model_display_name: manifest.display_name.into(),
            model_size_bytes: manifest.size,
            downloaded_bytes: downloaded,
            disk_space_sufficient: installed
                || available_disk >= remaining.saturating_add(DISK_HEADROOM_BYTES),
            installed,
            running: self.runtime.is_running().await,
            runtime_bundled: true,
            privacy_local: true,
        })
    }

    pub async fn status(&self) -> ManagedAiStatus {
        let mut status = self.status.read().await.clone();
        status.running = self.runtime.is_running().await;
        status
    }

    /// Returns the single authoritative state for the active provider. A provider is
    /// never reported as ready until this method has completed its real health check.
    pub async fn provider_state(&self, settings: &AiSettings, refresh: bool) -> AiProviderState {
        let revision = self.provider_revision.fetch_add(1, Ordering::SeqCst) + 1;
        let mut state = self.classify_provider(settings).await;
        self.store_provider_state_if_current(revision, state.clone())
            .await;
        if !refresh || matches!(state.status.as_str(), "disabled" | "unconfigured") {
            return state;
        }

        state.status = "checking".into();
        state.message = format!("正在检查 {}", state.display_name);
        state.technical_details = None;
        self.store_provider_state_if_current(revision, state.clone())
            .await;

        let checked = if settings.provider == "managed-local" {
            self.test(&settings.model).await
        } else {
            probe_remote(settings).await.map(|_| true)
        };
        state.last_checked_at = Some(diagnostics::now_ms());
        match checked {
            Ok(true) => {
                state.status = "ready".into();
                state.message = format!("{} 已就绪", state.display_name);
                state.runtime_running =
                    settings.provider == "managed-local" && self.runtime.is_running().await;
                state.technical_details = None;
            }
            Ok(false) => {
                state.status = "error".into();
                state.message = format!("{} 健康检查失败", state.display_name);
                state.technical_details = Some("provider returned an empty health response".into());
            }
            Err(error) => {
                state.status = "error".into();
                state.message = format!("{} 暂时不可用", state.display_name);
                state.technical_details = Some(error.to_string());
            }
        }
        if self.provider_revision.load(Ordering::SeqCst) != revision {
            return self.wait_for_current_provider_state().await;
        }
        if state.status == "ready" {
            *self.last_ai_error.write().await = None;
        } else if let Some(details) = &state.technical_details {
            *self.last_ai_error.write().await = Some(details.clone());
        }
        self.store_provider_state_if_current(revision, state.clone())
            .await;
        state
    }

    pub async fn run_configured(
        &self,
        settings: &AiSettings,
        prompt: &str,
    ) -> Result<String, AppError> {
        let state = self.provider_state(settings, true).await;
        if state.status != "ready" {
            let message = state
                .technical_details
                .clone()
                .unwrap_or_else(|| state.message.clone());
            return if matches!(state.status.as_str(), "disabled" | "unconfigured") {
                Err(AppError::AiUnconfigured(message))
            } else {
                Err(AppError::Ai(message))
            };
        }

        let result = if settings.provider == "managed-local" {
            self.complete(&settings.model, prompt, 768).await
        } else {
            run_remote(settings, prompt).await
        };
        match &result {
            Ok(_) => {
                *self.last_ai_error.write().await = None;
                diagnostics::info(
                    "ai_provider_request_succeeded",
                    serde_json::json!({"provider": settings.provider, "model": settings.model}),
                );
            }
            Err(error) => {
                *self.last_ai_error.write().await = Some(error.to_string());
                let mut failed = state;
                failed.status = "error".into();
                failed.message = format!("{} 请求失败", failed.display_name);
                failed.technical_details = Some(error.to_string());
                let is_active = self.provider_state.read().await.provider == settings.provider;
                if is_active {
                    self.store_provider_state(failed).await;
                }
                diagnostics::error(
                    "ai_provider_request_failed",
                    serde_json::json!({"provider": settings.provider, "model": settings.model, "error": error.to_string()}),
                );
            }
        }
        result
    }

    pub async fn last_ai_error(&self) -> Option<String> {
        self.last_ai_error.read().await.clone()
    }

    pub async fn runtime_installed(&self) -> bool {
        self.runtime.is_installed().await
    }

    async fn classify_provider(&self, settings: &AiSettings) -> AiProviderState {
        match settings.provider.as_str() {
            "disabled" => provider_state(
                "disabled",
                "disabled",
                "AI 阅读助手尚未启用",
                false,
                false,
                false,
            ),
            "openai" if !settings.has_api_key => provider_state(
                "openai",
                "unconfigured",
                "OpenAI 尚未配置 API Key",
                false,
                false,
                false,
            ),
            "managed-local" => {
                let Some(manifest) = model_by_id(&settings.model) else {
                    return provider_state(
                        "managed-local",
                        "unconfigured",
                        "本地 AI 模型配置无效",
                        false,
                        false,
                        false,
                    );
                };
                let installed = self.models.is_installed(manifest).await;
                let running = self.runtime.is_running().await;
                if !installed {
                    provider_state(
                        "managed-local",
                        "unconfigured",
                        "本地 AI 模型尚未安装",
                        false,
                        false,
                        false,
                    )
                } else {
                    provider_state(
                        "managed-local",
                        "starting",
                        "本地 AI 将按需启动并检查",
                        false,
                        true,
                        running,
                    )
                }
            }
            "openai" | "ollama" | "custom"
                if settings.model.trim().is_empty() || settings.base_url.trim().is_empty() =>
            {
                provider_state(
                    &settings.provider,
                    "unconfigured",
                    "AI 服务配置不完整",
                    settings.has_api_key,
                    false,
                    false,
                )
            }
            "openai" | "ollama" | "custom" => provider_state(
                &settings.provider,
                "checking",
                "AI 服务等待健康检查",
                settings.has_api_key,
                false,
                false,
            ),
            _ => provider_state(
                &settings.provider,
                "unconfigured",
                "不支持的 AI 服务配置",
                settings.has_api_key,
                false,
                false,
            ),
        }
    }

    async fn store_provider_state(&self, state: AiProviderState) {
        diagnostics::info(
            "ai_provider_state",
            serde_json::json!({
                "provider": state.provider,
                "status": state.status,
                "apiKeyConfigured": state.has_api_key,
                "modelInstalled": state.model_installed,
                "runtimeRunning": state.runtime_running,
            }),
        );
        *self.provider_state.write().await = state;
    }

    async fn store_provider_state_if_current(&self, revision: u64, state: AiProviderState) {
        if self.provider_revision.load(Ordering::SeqCst) == revision {
            self.store_provider_state(state).await;
        }
    }

    async fn wait_for_current_provider_state(&self) -> AiProviderState {
        for _ in 0..1_900 {
            let state = self.provider_state.read().await.clone();
            if !matches!(
                state.status.as_str(),
                "checking" | "starting" | "installing"
            ) {
                return state;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.provider_state.read().await.clone()
    }

    pub async fn prepare(
        &self,
        app: &AppHandle,
        runtime_archive: &Path,
    ) -> Result<ManagedAiStatus, AppError> {
        let _guard = self.install_guard.lock().await;
        let assessment = self.assess().await?;
        if !assessment.supported {
            return self
                .fail(
                    app,
                    "此设备暂不支持一键本地 AI",
                    "managed runtime currently supports Windows x64 only".into(),
                )
                .await;
        }
        if !assessment.disk_space_sufficient {
            return self
                .fail(
                    app,
                    "磁盘空间不足，请释放空间后重试",
                    format!(
                        "available={} required_model={} downloaded={} headroom={DISK_HEADROOM_BYTES}",
                        assessment.available_disk_bytes,
                        assessment.model_size_bytes,
                        assessment.downloaded_bytes
                    ),
                )
                .await;
        }
        let manifest = model_by_id(&assessment.selected_model_id)
            .ok_or_else(|| AppError::Ai("selected managed model is unknown".into()))?;
        let control = SetupControl {
            cancel: CancellationToken::new(),
            action: Arc::new(AtomicU8::new(SETUP_RUNNING)),
        };
        *self.setup.lock().await = Some(control.clone());

        self.set_status(
            app,
            status_for(
                "preparing",
                manifest,
                assessment.downloaded_bytes,
                false,
                false,
                "正在准备本地 AI 运行组件",
            ),
        )
        .await;

        let result = async {
            self.runtime.install_from_archive(runtime_archive).await?;
            let model_path = self.models.install(manifest, app, &control.cancel).await?;
            self.set_status(
                app,
                status_for(
                    "starting",
                    manifest,
                    manifest.size,
                    true,
                    false,
                    "正在启动并检查本地 AI",
                ),
            )
            .await;
            let answer = self
                .runtime
                .complete(
                    manifest,
                    &model_path,
                    "Translate the word Hello into Chinese. Return only the translation.",
                    32,
                )
                .await?;
            if answer.trim().is_empty() || !contains_cjk(&answer) {
                return Err(AppError::Ai(
                    "local AI health check did not return a Chinese translation".into(),
                ));
            }
            Ok::<(), AppError>(())
        }
        .await;

        *self.setup.lock().await = None;
        match result {
            Ok(()) => {
                let ready = status_for(
                    "ready",
                    manifest,
                    manifest.size,
                    true,
                    true,
                    "本地 AI 已就绪",
                );
                self.set_status(app, ready.clone()).await;
                Ok(ready)
            }
            Err(_error) if control.cancel.is_cancelled() => {
                let action = control.action.load(Ordering::SeqCst);
                if action == SETUP_CANCELLED {
                    self.models.discard_partial(manifest).await?;
                }
                let downloaded = self.models.partial_size(manifest).await;
                let state = if action == SETUP_PAUSED {
                    "paused"
                } else {
                    "idle"
                };
                let message = if action == SETUP_PAUSED {
                    "下载已暂停，可随时继续"
                } else {
                    "已取消本地 AI 设置"
                };
                let status = status_for(state, manifest, downloaded, false, false, message);
                self.set_status(app, status.clone()).await;
                Ok(status)
            }
            Err(error) => {
                self.fail(app, "本地 AI 暂时无法启用，请重试", error.to_string())
                    .await
            }
        }
    }

    pub async fn pause_setup(&self) -> bool {
        let paused = self.interrupt_setup(SETUP_PAUSED).await;
        diagnostics::info(
            "managed_model_download_paused",
            serde_json::json!({"accepted": paused}),
        );
        paused
    }

    pub async fn cancel_setup(&self) -> bool {
        self.interrupt_setup(SETUP_CANCELLED).await
    }

    pub async fn delete_models(&self, app: &AppHandle) -> Result<ManagedAiStatus, AppError> {
        self.cancel_setup().await;
        let _guard = self.install_guard.lock().await;
        self.runtime.stop().await;
        self.models.delete_all().await?;
        let assessment = self.assess().await?;
        let manifest = model_by_id(&assessment.selected_model_id)
            .ok_or_else(|| AppError::Ai("selected managed model is unknown".into()))?;
        let status = status_for("idle", manifest, 0, false, false, "本地 AI 模型已移除");
        self.set_status(app, status.clone()).await;
        Ok(status)
    }

    pub async fn complete(
        &self,
        model_id: &str,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, AppError> {
        let manifest = model_by_id(model_id)
            .ok_or_else(|| AppError::Ai("configured local model is unknown".into()))?;
        if !self.models.is_installed(manifest).await {
            return Err(AppError::Ai("本地 AI 模型尚未安装".into()));
        }
        self.runtime
            .complete(
                manifest,
                &self.models.model_path(manifest),
                prompt,
                max_tokens,
            )
            .await
    }

    pub async fn test(&self, model_id: &str) -> Result<bool, AppError> {
        let output = self
            .complete(
                model_id,
                "Reply with the single word OK. Do not add punctuation.",
                16,
            )
            .await?;
        Ok(!output.trim().is_empty())
    }

    pub async fn restart(&self, model_id: &str) -> Result<bool, AppError> {
        self.runtime.stop().await;
        self.test(model_id).await
    }

    pub fn shutdown_blocking(&self) {
        self.runtime.stop_blocking();
    }

    async fn interrupt_setup(&self, action: u8) -> bool {
        let control = self.setup.lock().await.clone();
        if let Some(control) = control {
            control.action.store(action, Ordering::SeqCst);
            control.cancel.cancel();
            true
        } else {
            false
        }
    }

    async fn set_status(&self, app: &AppHandle, status: ManagedAiStatus) {
        *self.status.write().await = status.clone();
        let _ = app.emit("managed-ai-status", status);
    }

    async fn fail(
        &self,
        app: &AppHandle,
        message: &str,
        details: String,
    ) -> Result<ManagedAiStatus, AppError> {
        let mut status = self.status.read().await.clone();
        status.state = "error".into();
        status.running = false;
        status.message = message.into();
        status.technical_details = Some(details);
        status.can_pause = false;
        status.can_retry = true;
        self.set_status(app, status.clone()).await;
        Ok(status)
    }
}

fn provider_state(
    provider: &str,
    status: &str,
    message: &str,
    has_api_key: bool,
    model_installed: bool,
    runtime_running: bool,
) -> AiProviderState {
    AiProviderState {
        provider: provider.into(),
        display_name: match provider {
            "openai" => "OpenAI",
            "ollama" => "Ollama",
            "custom" => "自定义 AI 服务",
            "managed-local" => "ScholarReader 本地 AI",
            _ => "AI 阅读助手",
        }
        .into(),
        status: status.into(),
        message: message.into(),
        has_api_key,
        model_installed,
        runtime_running,
        last_checked_at: None,
        technical_details: None,
    }
}

fn status_for(
    state: &str,
    manifest: &ModelManifest,
    downloaded: u64,
    installed: bool,
    running: bool,
    message: &str,
) -> ManagedAiStatus {
    ManagedAiStatus {
        state: state.into(),
        model_id: manifest.id.into(),
        model_display_name: manifest.display_name.into(),
        downloaded_bytes: downloaded.min(manifest.size),
        total_bytes: manifest.size,
        installed,
        running,
        message: message.into(),
        technical_details: None,
        can_pause: matches!(state, "preparing" | "downloading-model"),
        can_retry: matches!(state, "paused" | "error"),
    }
}

fn contains_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|character| ('\u{4e00}'..='\u{9fff}').contains(&character))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::manifest::QWEN3_17B;

    #[test]
    fn ready_status_is_not_retryable() {
        let status = status_for("ready", &QWEN3_06B, QWEN3_06B.size, true, true, "ready");
        assert!(status.installed);
        assert!(status.running);
        assert!(!status.can_retry);
    }

    #[test]
    fn pinned_manifests_remain_addressable() {
        assert_eq!(model_by_id(QWEN3_17B.id).unwrap().sha256, QWEN3_17B.sha256);
    }

    #[test]
    fn health_check_requires_a_real_chinese_result() {
        assert!(contains_cjk("你好"));
        assert!(!contains_cjk("OK"));
    }

    #[test]
    fn openai_without_key_can_never_be_ready() {
        let state = provider_state(
            "openai",
            "unconfigured",
            "OpenAI 尚未配置 API Key",
            false,
            false,
            false,
        );
        assert_eq!(state.status, "unconfigured");
        assert!(!state.has_api_key);
    }

    #[tokio::test]
    async fn openai_without_key_is_rejected_before_any_network_request() {
        let root = tempfile::tempdir().expect("temporary managed AI root");
        let manager = AIServiceManager::new(root.path().to_path_buf()).expect("manager");
        let settings = AiSettings {
            provider: "openai".into(),
            model: "gpt-4.1-mini".into(),
            base_url: "http://127.0.0.1:1/v1".into(),
            target_language: "中文".into(),
            has_api_key: false,
        };
        let state = manager.provider_state(&settings, true).await;
        assert_eq!(state.status, "unconfigured");
        assert!(matches!(
            manager.run_configured(&settings, "never sent").await,
            Err(AppError::AiUnconfigured(_))
        ));
    }
}
