import { create } from "zustand";
import type {
  AiAction,
  AiAssistantContext,
  AiProviderState,
  AiSettings,
} from "../core/models/ai";
import type { SelectionCapture } from "../core/models/favorite";
import { aiGateway } from "../platform/tauri/aiGateway";
import { RustAIProvider } from "../features/ai/AIProvider";
import { reportFrontendEvent } from "../platform/tauri/diagnostics";

type RequestStatus = "idle" | "loading" | "success" | "error" | "cancelled";

type AiState = {
  settings: AiSettings | null;
  providerState: AiProviderState | null;
  context: AiAssistantContext | null;
  output: string;
  error: string | null;
  status: RequestStatus;
  activeRequestId: string | null;
  onboardingOpen: boolean;
  loadSettings: () => Promise<void>;
  refreshProviderState: (refresh?: boolean) => Promise<AiProviderState>;
  setSettings: (settings: AiSettings) => void;
  run: (action: AiAction, selection: SelectionCapture) => Promise<void>;
  regenerate: () => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  finishOnboarding: () => Promise<void>;
};

function readableError(reason: unknown): string {
  if (typeof reason === "object" && reason && "message" in reason) return String(reason.message);
  return reason instanceof Error ? reason.message : String(reason);
}

function createRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readProviderSnapshot(refresh = true): Promise<{ settings: AiSettings; providerState: AiProviderState }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const settings = await aiGateway.getSettings();
    const providerState = await aiGateway.getProviderState(refresh);
    if (settings.provider === providerState.provider) return { settings, providerState };
  }
  throw new Error("AI Provider 状态正在切换，请重试");
}

let providerRefreshSequence = 0;

async function execute(
  set: (partial: Partial<AiState>) => void,
  get: () => AiState,
  context: AiAssistantContext,
): Promise<void> {
  const { settings, providerState } = await readProviderSnapshot(true);
  set({ settings, providerState, context, output: "", error: null });
  void reportFrontendEvent("ai_action_clicked", {
    action: context.action,
    selectionLength: context.selection.selectedText.length,
    provider: providerState.provider,
    providerStatus: providerState.status,
  });
  if (providerState.status !== "ready") {
    if (matchesSetupState(providerState.status)) {
      set({ status: "idle", error: null, onboardingOpen: true });
    } else {
      set({
        status: "error",
        error: `${providerState.displayName} 暂时不可用：${providerState.message}`,
        onboardingOpen: false,
      });
    }
    return;
  }
  const requestId = createRequestId();
  set({ status: "loading", activeRequestId: requestId });
  try {
    const provider = new RustAIProvider(requestId);
    const surroundingContext = `${context.selection.contextBefore}\n${context.selection.contextAfter}`.trim();
    const result = context.action === "explain"
      ? await provider.explain(context.selection.selectedText, surroundingContext)
      : context.action === "translate"
        ? await provider.translate(context.selection.selectedText, settings.targetLanguage)
        : await provider.summarize(context.selection.selectedText);
    if (get().activeRequestId !== requestId) return;
    set({ status: "success", output: result, activeRequestId: null });
    void reportFrontendEvent("ai_action_succeeded", { action: context.action, provider: providerState.provider });
  } catch (reason) {
    if (get().activeRequestId !== requestId) return;
    set({
      status: "error",
      error: `AI 服务暂时不可用：${readableError(reason)}。你的 PDF、收藏和阅读数据不会受到影响。`,
      activeRequestId: null,
    });
    void reportFrontendEvent("ai_action_failed", {
      action: context.action,
      provider: providerState.provider,
      errorType: typeof reason === "object" && reason && "code" in reason ? String(reason.code) : "unknown",
    });
  }
}

function matchesSetupState(status: AiProviderState["status"]): boolean {
  return status === "disabled" || status === "unconfigured";
}

export const useAiStore = create<AiState>((set, get) => ({
  settings: null,
  providerState: null,
  context: null,
  output: "",
  error: null,
  status: "idle",
  activeRequestId: null,
  onboardingOpen: false,
  async loadSettings() {
    const sequence = ++providerRefreshSequence;
    try {
      const { settings, providerState } = await readProviderSnapshot(true);
      if (sequence === providerRefreshSequence) set({ settings, providerState });
    } catch (reason) {
      set({ error: readableError(reason) });
    }
  },
  async refreshProviderState(refresh = true) {
    const sequence = ++providerRefreshSequence;
    const { settings, providerState } = await readProviderSnapshot(refresh);
    if (sequence === providerRefreshSequence) set({ settings, providerState });
    return providerState;
  },
  setSettings(settings) {
    set({ settings, providerState: null });
  },
  async run(action, selection) {
    await execute(set, get, { action, selection });
  },
  async regenerate() {
    const context = get().context;
    if (context) await execute(set, get, context);
  },
  async cancel() {
    const requestId = get().activeRequestId;
    if (!requestId) return;
    set({ status: "cancelled", activeRequestId: null, error: null });
    await aiGateway.cancel(requestId).catch(() => false);
  },
  clear() {
    const requestId = get().activeRequestId;
    if (requestId) void aiGateway.cancel(requestId);
    set({ context: null, output: "", error: null, status: "idle", activeRequestId: null });
  },
  openOnboarding() {
    set({ onboardingOpen: true });
  },
  closeOnboarding() {
    set({ onboardingOpen: false });
  },
  async finishOnboarding() {
    const { settings, providerState } = await readProviderSnapshot(true);
    const context = get().context;
    set({ settings, providerState, onboardingOpen: false });
    if (context && providerState.status === "ready") await execute(set, get, context);
  },
}));
