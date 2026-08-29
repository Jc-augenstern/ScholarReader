import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AiAction,
  AiResponse,
  AiSettings,
  AiProviderState,
  SaveAiSettingsInput,
  ManagedAiAssessment,
  ManagedAiProgress,
  ManagedAiStatus,
} from "../../core/models/ai";
import { isDesktopRuntime } from "./runtime";
import { reportFrontendEvent } from "./diagnostics";

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (reason) {
    void reportFrontendEvent("rust_invoke_error", {
      command,
      errorType: typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "unknown",
    });
    throw reason;
  }
}

const previewSettings: AiSettings = {
  provider: "disabled",
  model: "gpt-4.1-mini",
  baseUrl: "https://api.openai.com/v1",
  targetLanguage: "中文",
  hasApiKey: false,
};

const previewManagedStatus: ManagedAiStatus = {
  state: "idle",
  modelId: "qwen3-1.7b-q8_0",
  modelDisplayName: "均衡本地 AI",
  downloadedBytes: 0,
  totalBytes: 1_834_426_016,
  installed: false,
  running: false,
  message: "桌面应用中可一键启用",
  technicalDetails: null,
  canPause: false,
  canRetry: false,
};

const previewProviderState: AiProviderState = {
  provider: "disabled",
  displayName: "AI 阅读助手",
  status: "disabled",
  message: "AI 阅读助手尚未启用",
  hasApiKey: false,
  modelInstalled: false,
  runtimeRunning: false,
  lastCheckedAt: null,
  technicalDetails: null,
};

export const aiGateway = {
  getSettings(): Promise<AiSettings> {
    if (!isDesktopRuntime()) return Promise.resolve(previewSettings);
    return invoke<AiSettings>("get_ai_settings");
  },

  getProviderState(refresh = true): Promise<AiProviderState> {
    if (!isDesktopRuntime()) {
      const disabled = previewSettings.provider === "disabled";
      const unconfigured = previewSettings.provider === "openai" && !previewSettings.hasApiKey;
      return Promise.resolve({
        ...previewProviderState,
        provider: previewSettings.provider,
        displayName: previewSettings.provider === "openai" ? "OpenAI" : previewProviderState.displayName,
        status: disabled ? "disabled" : unconfigured ? "unconfigured" : "ready",
        message: disabled ? "AI 阅读助手尚未启用" : unconfigured ? "OpenAI 尚未配置 API Key" : "AI 服务已就绪",
        hasApiKey: previewSettings.hasApiKey,
      });
    }
    return invoke<AiProviderState>("get_ai_provider_state", { refresh });
  },

  saveSettings(input: SaveAiSettingsInput): Promise<AiSettings> {
    if (!isDesktopRuntime()) {
      Object.assign(previewSettings, {
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        targetLanguage: input.targetLanguage,
        hasApiKey: Boolean(input.apiKey) && !input.clearApiKey,
      });
      return Promise.resolve({ ...previewSettings });
    }
    return invoke<AiSettings>("save_ai_settings", { input });
  },

  testConnection(): Promise<boolean> {
    if (!isDesktopRuntime()) return Promise.reject(new Error("浏览器预览不连接 AI 服务"));
    return invoke<boolean>("test_ai_connection");
  },

  run(
    requestId: string,
    action: AiAction,
    text: string,
    context?: string,
    targetLanguage?: string,
  ): Promise<AiResponse> {
    if (!isDesktopRuntime()) return Promise.reject(new Error("浏览器预览不连接 AI 服务"));
    return invoke<AiResponse>("run_ai_action", {
      input: { requestId, action, text, context, targetLanguage },
    });
  },

  cancel(requestId: string): Promise<boolean> {
    if (!isDesktopRuntime()) return Promise.resolve(false);
    return invoke<boolean>("cancel_ai_request", { requestId });
  },

  assessManaged(): Promise<ManagedAiAssessment> {
    if (!isDesktopRuntime()) return Promise.resolve({
      supported: true,
      operatingSystem: "windows",
      architecture: "x86_64",
      logicalCpuCount: 8,
      totalMemoryBytes: 16 * 1024 ** 3,
      availableDiskBytes: 20 * 1024 ** 3,
      selectedModelId: previewManagedStatus.modelId,
      selectedModelDisplayName: previewManagedStatus.modelDisplayName,
      modelSizeBytes: previewManagedStatus.totalBytes,
      downloadedBytes: 0,
      diskSpaceSufficient: true,
      installed: false,
      running: false,
      runtimeBundled: true,
      privacyLocal: true,
    });
    return invoke<ManagedAiAssessment>("assess_managed_ai");
  },

  getManagedStatus(): Promise<ManagedAiStatus> {
    if (!isDesktopRuntime()) return Promise.resolve({ ...previewManagedStatus });
    return invoke<ManagedAiStatus>("get_managed_ai_status");
  },

  prepareManaged(): Promise<ManagedAiStatus> {
    if (!isDesktopRuntime()) return Promise.reject(new Error("请在桌面应用中下载并启用本地 AI"));
    return invoke<ManagedAiStatus>("prepare_managed_ai");
  },

  pauseManagedSetup(): Promise<boolean> {
    if (!isDesktopRuntime()) return Promise.resolve(false);
    return invoke<boolean>("pause_managed_ai_setup");
  },

  cancelManagedSetup(): Promise<boolean> {
    if (!isDesktopRuntime()) return Promise.resolve(false);
    return invoke<boolean>("cancel_managed_ai_setup");
  },

  deleteManagedModels(): Promise<ManagedAiStatus> {
    if (!isDesktopRuntime()) return Promise.resolve({ ...previewManagedStatus });
    return invoke<ManagedAiStatus>("delete_managed_ai_models");
  },

  restartManaged(): Promise<boolean> {
    if (!isDesktopRuntime()) return Promise.resolve(false);
    return invoke<boolean>("restart_managed_ai");
  },

  testManaged(): Promise<boolean> {
    if (!isDesktopRuntime()) return Promise.resolve(false);
    return invoke<boolean>("test_managed_ai");
  },

  onManagedProgress(handler: (progress: ManagedAiProgress) => void): Promise<UnlistenFn> {
    if (!isDesktopRuntime()) return Promise.resolve(() => undefined);
    return listen<ManagedAiProgress>("managed-ai-progress", (event) => handler(event.payload));
  },

  onManagedStatus(handler: (status: ManagedAiStatus) => void): Promise<UnlistenFn> {
    if (!isDesktopRuntime()) return Promise.resolve(() => undefined);
    return listen<ManagedAiStatus>("managed-ai-status", (event) => handler(event.payload));
  },
};
