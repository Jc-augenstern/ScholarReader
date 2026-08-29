import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProviderState, AiSettings } from "../core/models/ai";
import type { SelectionCapture } from "../core/models/favorite";
import { aiGateway } from "../platform/tauri/aiGateway";
import { useAiStore } from "./aiStore";

const selection: SelectionCapture = {
  documentId: "document-1",
  selectedText: "Artificial intelligence helps readers.",
  normalizedText: "Artificial intelligence helps readers.",
  pageNumber: 1,
  textStartIndex: 0,
  textEndIndex: 40,
  contextBefore: "",
  contextAfter: "",
  selectionRectsJson: "[]",
  rects: [],
  bounds: { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 },
};

const disabled: AiSettings = {
  provider: "disabled",
  model: "gpt-4.1-mini",
  baseUrl: "https://api.openai.com/v1",
  targetLanguage: "中文",
  hasApiKey: false,
};

const disabledState: AiProviderState = {
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

describe("AI onboarding trigger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(aiGateway, "getSettings").mockResolvedValue(disabled);
    useAiStore.setState({
      settings: disabled,
      providerState: disabledState,
      context: null,
      output: "",
      error: null,
      status: "idle",
      activeRequestId: null,
      onboardingOpen: false,
    });
  });

  it("opens friendly onboarding instead of showing a configuration error", async () => {
    vi.spyOn(aiGateway, "getProviderState").mockResolvedValue(disabledState);
    await useAiStore.getState().run("translate", selection);
    expect(useAiStore.getState().onboardingOpen).toBe(true);
    expect(useAiStore.getState().error).toBeNull();
    expect(useAiStore.getState().context?.action).toBe("translate");
  });

  it("replays the pending action after a provider becomes ready", async () => {
    const managed: AiSettings = { ...disabled, provider: "managed-local", model: "qwen3-1.7b-q8_0", baseUrl: "" };
    const ready: AiProviderState = { ...disabledState, provider: "managed-local", displayName: "本地 AI", status: "ready", message: "本地 AI 已就绪", modelInstalled: true, runtimeRunning: true };
    vi.spyOn(aiGateway, "getSettings").mockResolvedValue(managed);
    vi.spyOn(aiGateway, "getProviderState").mockResolvedValue(ready);
    vi.spyOn(aiGateway, "run").mockResolvedValue({ content: "人工智能帮助读者。", provider: "managed-local", model: managed.model });
    useAiStore.setState({ context: { action: "translate", selection }, onboardingOpen: true });

    await useAiStore.getState().finishOnboarding();

    expect(useAiStore.getState().onboardingOpen).toBe(false);
    expect(useAiStore.getState().output).toBe("人工智能帮助读者。");
    expect(aiGateway.run).toHaveBeenCalledOnce();
  });

  it("treats a legacy OpenAI selection without a key as unconfigured and sends no request", async () => {
    const legacyOpenAI: AiSettings = { ...disabled, provider: "openai" };
    const unconfigured: AiProviderState = {
      ...disabledState,
      provider: "openai",
      displayName: "OpenAI",
      status: "unconfigured",
      message: "OpenAI 尚未配置 API Key",
    };
    useAiStore.setState({ settings: legacyOpenAI, providerState: unconfigured });
    vi.spyOn(aiGateway, "getSettings").mockResolvedValue(legacyOpenAI);
    vi.spyOn(aiGateway, "getProviderState").mockResolvedValue(unconfigured);
    const run = vi.spyOn(aiGateway, "run");

    await useAiStore.getState().run("explain", selection);

    expect(useAiStore.getState().onboardingOpen).toBe(true);
    expect(useAiStore.getState().error).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
