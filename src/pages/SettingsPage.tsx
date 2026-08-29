import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  Command,
  FileDown,
  FolderOpen,
  HardDrive,
  KeyRound,
  Monitor,
  Moon,
  Palette,
  PlugZap,
  RotateCw,
  Save,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { AiProviderKind, AiProviderStatus, AiSettings, DiagnosticsSnapshot, ManagedAiAssessment, ManagedAiStatus } from "../core/models/ai";
import { aiServiceManager } from "../features/ai/AIServiceManager";
import { OpenAISetupWizard } from "../features/ai/OpenAISetupWizard";
import { aiGateway } from "../platform/tauri/aiGateway";
import { diagnosticsGateway, reportFrontendEvent } from "../platform/tauri/diagnostics";
import type { AccentPreference } from "../platform/tauri/settingsGateway";
import { useAiStore } from "../stores/aiStore";
import { useSettingsStore } from "../stores/settingsStore";

type AdvancedProvider = Exclude<AiProviderKind, "managed-local">;

const defaults: Record<Exclude<AdvancedProvider, "disabled">, { url: string; model: string }> = {
  openai: { url: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  ollama: { url: "http://localhost:11434", model: "qwen3:8b" },
  custom: { url: "http://localhost:8080/v1", model: "default" },
};

const uiScaleOptions = [
  [80, "紧凑"],
  [90, "较小"],
  [100, "标准"],
  [110, "较大"],
  [125, "更大"],
  [150, "超大"],
] as const;

const fontScaleOptions = [
  [90, "较小"],
  [100, "标准"],
  [110, "较大"],
  [120, "特大"],
  [130, "最大"],
] as const;

const accentOptions: ReadonlyArray<[AccentPreference, string]> = [
  ["green", "绿色"],
  ["blue", "蓝色"],
  ["cyan", "青色"],
  ["purple", "紫色"],
  ["orange", "橙色"],
  ["red", "红色"],
  ["pink", "粉色"],
];

function errorMessage(reason: unknown): string {
  if (typeof reason === "object" && reason && "message" in reason) return String(reason.message);
  return reason instanceof Error ? reason.message : String(reason);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function providerName(provider: AiProviderKind): string {
  return { disabled: "未启用", "managed-local": "本地 AI", openai: "OpenAI", ollama: "Ollama", custom: "兼容 AI 服务" }[provider];
}

function providerStatusName(status: AiProviderStatus | undefined): string {
  return {
    disabled: "尚未启用",
    unconfigured: "尚未配置",
    installing: "正在安装",
    starting: "正在启动",
    checking: "正在检查",
    ready: "已就绪",
    error: "连接异常",
  }[status ?? "checking"];
}

function DiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => {
    setNotice(null);
    try {
      setSnapshot(await diagnosticsGateway.getSnapshot());
    } catch (reason) {
      setNotice(`诊断信息读取失败：${errorMessage(reason)}`);
    }
  };
  useEffect(() => { void refresh(); }, []);
  const copy = async () => {
    if (!snapshot) return;
    await navigator.clipboard.writeText([
      "ScholarReader Diagnostics",
      "",
      `Version: ${snapshot.version}`,
      `Platform: ${snapshot.platform}`,
      `Provider: ${snapshot.provider}`,
      `Provider status: ${snapshot.providerStatus}`,
      `Model: ${snapshot.model || "none"}`,
      `Model installed: ${snapshot.modelInstalled}`,
      `Runtime installed: ${snapshot.runtimeInstalled}`,
      `Runtime running: ${snapshot.runtimeRunning}`,
      `Database schema: v${snapshot.databaseSchema}`,
      "",
      "Last AI error:",
      snapshot.lastAiError ?? "none",
    ].join("\n"));
    setNotice("诊断信息已复制。不会包含 API Key 或文档内容。");
  };
  return <div className="diagnostics-panel">
    <div className="settings-section-heading"><HardDrive size={18} /><div><strong>诊断</strong><span>运行状态与脱敏日志（不包含密钥、PDF 或选中文字）</span></div></div>
    {snapshot ? <div className="managed-ai-facts">
      <div><small>版本 / 平台</small><strong>{snapshot.version} · {snapshot.platform}</strong></div>
      <div><small>Provider</small><strong>{providerName(snapshot.provider)} · {providerStatusName(snapshot.providerStatus)}</strong></div>
      <div><small>模型</small><strong>{snapshot.model || "—"} · {snapshot.modelInstalled ? "已安装" : "未安装/不适用"}</strong></div>
      <div><small>Runtime</small><strong>{snapshot.runtimeRunning ? "运行中" : snapshot.runtimeInstalled ? "已安装，未运行" : "未安装/不适用"}</strong></div>
      <div><small>数据库 Migration</small><strong>{snapshot.databaseSchema}</strong></div>
      <div><small>最近 AI 错误</small><strong>{snapshot.lastAiError ?? "无"}</strong></div>
    </div> : <div className="page-loading"><span className="spinner dark" />正在检查…</div>}
    {snapshot ? <details><summary>日志目录</summary><code>{snapshot.logDirectory}</code></details> : null}
    <div className="settings-actions">
      <button className="secondary-button" onClick={() => void refresh()} type="button"><RotateCw size={15} />刷新</button>
      <button className="secondary-button" onClick={() => void diagnosticsGateway.openLogs().catch((reason) => setNotice(errorMessage(reason)))} type="button"><FolderOpen size={15} />打开日志目录</button>
      <button className="secondary-button" disabled={!snapshot} onClick={() => void copy()} type="button"><Copy size={15} />复制诊断信息</button>
      <button className="secondary-button" onClick={() => void diagnosticsGateway.exportReport().then((path) => setNotice(`诊断报告已导出：${path}`), (reason) => setNotice(errorMessage(reason)))} type="button"><FileDown size={15} />导出诊断报告</button>
    </div>
    {notice ? <span className="settings-message">{notice}</span> : null}
  </div>;
}

export function SettingsPage() {
  const current = useAiStore((state) => state.settings);
  const providerState = useAiStore((state) => state.providerState);
  const setSettings = useAiStore((state) => state.setSettings);
  const loadSettings = useAiStore((state) => state.loadSettings);
  const refreshProviderState = useAiStore((state) => state.refreshProviderState);
  const openOnboarding = useAiStore((state) => state.openOnboarding);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [openAIWizard, setOpenAIWizard] = useState(false);
  const [manageLocal, setManageLocal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assessment, setAssessment] = useState<ManagedAiAssessment | null>(null);
  const [managedStatus, setManagedStatus] = useState<ManagedAiStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const theme = useSettingsStore((state) => state.theme);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const fontScale = useSettingsStore((state) => state.fontScale);
  const accent = useSettingsStore((state) => state.accent);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const setUiScale = useSettingsStore((state) => state.setUiScale);
  const setFontScale = useSettingsStore((state) => state.setFontScale);
  const setAccent = useSettingsStore((state) => state.setAccent);
  const resetDisplayScale = useSettingsStore((state) => state.resetDisplayScale);

  useEffect(() => {
    if (!current) void loadSettings();
    else setDraft(current);
  }, [current, loadSettings]);

  useEffect(() => {
    void Promise.all([aiServiceManager.assessLocalDevice(), aiServiceManager.getLocalStatus()])
      .then(([nextAssessment, nextStatus]) => {
        setAssessment(nextAssessment);
        setManagedStatus(nextStatus);
      })
      .catch(() => undefined);
  }, [current?.provider]);

  useEffect(() => {
    if (current) void refreshProviderState(true).catch(() => undefined);
  }, [current?.provider, refreshProviderState]);

  useEffect(() => {
    if (providerState) void reportFrontendEvent("provider_ui_state", {
      provider: providerState.provider,
      status: providerState.status,
      apiKeyConfigured: providerState.hasApiKey,
      modelInstalled: providerState.modelInstalled,
      runtimeRunning: providerState.runtimeRunning,
    });
  }, [providerState]);

  const update = (partial: Partial<AiSettings>) => setDraft((value) => value ? { ...value, ...partial } : value);

  const saveAdvanced = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || draft.provider === "managed-local") return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await aiGateway.saveSettings({
        provider: draft.provider,
        model: draft.model,
        baseUrl: draft.baseUrl,
        targetLanguage: draft.targetLanguage,
        apiKey: apiKey || undefined,
        clearApiKey,
      });
      setSettings(saved);
      setDraft(saved);
      setApiKey("");
      setClearApiKey(false);
      await refreshProviderState(true);
      setMessage("设置已保存。密钥未写入 SQLite。");
    } catch (reason) {
      setMessage(`保存失败：${errorMessage(reason)}`);
    } finally {
      setSaving(false);
    }
  };

  const refreshCurrent = async () => {
    const settings = await aiGateway.getSettings();
    setSettings(settings);
    setDraft(settings);
    await refreshProviderState(true);
  };

  if (!draft || !current) return <div className="page-loading"><span className="spinner dark" />正在读取设置…</div>;

  const ready = providerState?.status === "ready";
  const needsSetup = providerState?.status === "disabled" || providerState?.status === "unconfigured";
  const localInstalled = assessment?.installed || managedStatus?.installed;

  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div><span className="eyebrow">偏好</span><h1>设置</h1><p>AI 是可选增强；关闭后所有本地阅读与收藏功能仍可使用。</p></div>
      </div>

      <section className="settings-card ai-settings-summary">
        <div className="settings-section-heading"><Sparkles size={18} /><div><strong>AI 阅读助手</strong><span>翻译、解释和总结阅读内容</span></div></div>
        <div className="ai-status-overview">
          <div><span className={`large-status-dot ${ready ? "ready" : ""}`} /><div><small>状态</small><strong>{providerStatusName(providerState?.status)}</strong></div></div>
          <div><small>当前服务</small><strong>{providerName(current.provider)}</strong></div>
          <div><small>运行状态</small><strong>{providerState?.message ?? "正在检查配置"}</strong></div>
        </div>
        {current.provider === "managed-local" ? <div className="local-privacy settings-privacy"><ShieldCheck size={20} /><div><strong>本地处理</strong><span>选中的文字只在你的电脑上处理，不会发送到云端。</span></div></div> : null}
        {current.provider !== "disabled" && current.provider !== "managed-local" ? <div className="local-privacy settings-privacy cloud"><Cloud size={20} /><div><strong>云端处理</strong><span>配置并通过检查后，选中的文字会发送给 {providerName(current.provider)} 进行处理。</span></div></div> : null}
        <div className="settings-actions">
          {needsSetup ? <button className="primary-button" onClick={openOnboarding} type="button"><Sparkles size={16} />配置 AI 阅读助手</button> : null}
          {current.provider === "managed-local" ? <>
            <button className="secondary-button" disabled={testing} onClick={() => {
              setTesting(true); setMessage(null);
              void aiServiceManager.testLocalAI().then(() => setMessage("AI 测试成功，可以正常使用。"))
                .catch((reason) => setMessage(`AI 暂时无法使用：${errorMessage(reason)}`)).finally(() => setTesting(false));
            }} type="button"><CheckCircle2 size={16} />{testing ? "测试中…" : "测试 AI"}</button>
            <button className="secondary-button" onClick={() => setManageLocal((value) => !value)} type="button"><HardDrive size={16} />管理本地 AI</button>
          </> : null}
          {message ? <span className="settings-message">{message}</span> : null}
        </div>

        {manageLocal ? <div className="managed-ai-panel">
          <div className="managed-ai-facts">
            <div><small>AI 模型</small><strong>{localInstalled ? "已安装" : "未安装"}</strong></div>
            <div><small>大小</small><strong>{assessment ? formatBytes(assessment.modelSizeBytes) : "检查中…"}</strong></div>
            <div><small>运行</small><strong>{managedStatus?.running ? "正常" : "按需启动"}</strong></div>
          </div>
          <details><summary>高级信息</summary><code>{assessment?.selectedModelId ?? managedStatus?.modelId ?? "—"}</code></details>
          <div className="settings-actions">
            {localInstalled ? <button className="secondary-button" onClick={() => { setTesting(true); void aiServiceManager.restartLocalAI().then(() => setMessage("本地 AI 已重新启动。"), (reason) => setMessage(`重新启动失败：${errorMessage(reason)}`)).finally(() => setTesting(false)); }} type="button"><RotateCw size={15} />重新启动 AI</button> : <button className="primary-button" onClick={openOnboarding} type="button">下载本地 AI</button>}
            {localInstalled ? <button className="secondary-button" disabled={testing} onClick={() => {
              setTesting(true);
              void aiServiceManager.removeLocalModels().then(async (status) => {
                setManagedStatus(status);
                setAssessment(await aiServiceManager.assessLocalDevice());
                await refreshCurrent();
                setManageLocal(false);
                openOnboarding();
              }).catch((reason) => setMessage(`无法开始重新下载：${errorMessage(reason)}`)).finally(() => setTesting(false));
            }} type="button"><RotateCw size={15} />重新下载模型</button> : null}
            {localInstalled ? <button className="danger-button" onClick={() => setConfirmDelete(true)} type="button"><Trash2 size={15} />删除本地模型</button> : null}
          </div>
          {confirmDelete ? <div className="delete-confirmation"><strong>确认删除本地 AI 模型？</strong><p>删除后翻译、解释和总结将暂时不可用，但不会影响 PDF、收藏、标签、笔记或阅读进度。</p><div><button className="secondary-button" onClick={() => setConfirmDelete(false)} type="button">取消</button><button className="danger-button" onClick={() => {
            setTesting(true);
            void aiServiceManager.removeLocalModels().then(async (status) => { setManagedStatus(status); setAssessment(await aiServiceManager.assessLocalDevice()); await refreshCurrent(); setConfirmDelete(false); setMessage("本地 AI 模型已删除，其他数据未受影响。"); }).catch((reason) => setMessage(`删除失败：${errorMessage(reason)}`)).finally(() => setTesting(false));
          }} type="button">确认删除</button></div></div> : null}
        </div> : null}
      </section>

      <section className="settings-card compact">
        <div className="settings-section-heading"><Cloud size={18} /><div><strong>其他 AI 服务</strong><span>适合已有 OpenAI API 或本地模型服务的用户</span></div></div>
        <div className="settings-actions">
          <button className="secondary-button" onClick={() => setOpenAIWizard((value) => !value)} type="button">连接 OpenAI <ChevronRight size={15} /></button>
          <button className="secondary-button" onClick={() => setAdvancedOpen(true)} type="button">连接其他 AI 服务 <ChevronRight size={15} /></button>
        </div>
        {openAIWizard ? <OpenAISetupWizard onConnected={async () => { await refreshCurrent(); setOpenAIWizard(false); setMessage("OpenAI 已连接并设为当前 AI 服务。"); }} /> : null}
      </section>

      <section className="settings-card compact advanced-settings-card">
        <button aria-expanded={advancedOpen} className="advanced-toggle" onClick={() => setAdvancedOpen((value) => !value)} type="button"><PlugZap size={17} /><span><strong>高级设置</strong><small>Provider、模型、API 地址和凭据</small></span><ChevronDown className={advancedOpen ? "open" : ""} size={17} /></button>
        {advancedOpen ? <form className="advanced-provider-form" onSubmit={(event) => void saveAdvanced(event)}>
          <p>以下设置面向熟悉 API 或已经运行 Ollama 的用户。现有 Provider 功能保持不变。</p>
          <div className="provider-options">
            {([
              ["disabled", "不使用 AI", "Core 功能保持可用"],
              ["openai", "OpenAI", "OpenAI Chat Completions API"],
              ["ollama", "Ollama", "连接已安装的本机 Ollama"],
              ["custom", "自定义兼容 API", "连接兼容服务"],
            ] as const).map(([value, label, description]) => (
              <label className={draft.provider === value ? "selected" : ""} key={value}>
                <input checked={draft.provider === value} name="provider" onChange={() => {
                  if (value === "disabled") update({ provider: value, baseUrl: "" });
                  else update({ provider: value, baseUrl: defaults[value].url, model: defaults[value].model });
                }} type="radio" />
                <span><strong>{label}</strong><small>{description}</small></span>
              </label>
            ))}
          </div>
          {draft.provider !== "disabled" && draft.provider !== "managed-local" ? <div className="settings-fields">
            <label>模型<input onChange={(event) => update({ model: event.target.value })} required value={draft.model} /></label>
            <label>API 地址<input onChange={(event) => update({ baseUrl: event.target.value })} required type="url" value={draft.baseUrl} /></label>
            <label>默认目标语言<input maxLength={40} onChange={(event) => update({ targetLanguage: event.target.value })} required value={draft.targetLanguage} /></label>
            {draft.provider !== "ollama" ? <label>API Key<div className="secret-input"><KeyRound size={15} /><input autoComplete="off" onChange={(event) => { setApiKey(event.target.value); setClearApiKey(false); }} placeholder={draft.hasApiKey ? "已安全保存；留空则保持不变" : "输入 API Key"} type="password" value={apiKey} /></div></label> : null}
            {draft.hasApiKey ? <label className="clear-secret"><input checked={clearApiKey} onChange={(event) => setClearApiKey(event.target.checked)} type="checkbox" />删除已保存的 API Key</label> : null}
          </div> : null}
          <div className="settings-actions"><button className="primary-button" disabled={saving || draft.provider === "managed-local"} type="submit"><Save size={16} />{saving ? "保存中…" : "保存高级设置"}</button>{draft.provider !== "disabled" && draft.provider !== "managed-local" ? <button className="secondary-button" disabled={testing || saving} onClick={() => { setTesting(true); setMessage(null); void aiGateway.testConnection().then(() => setMessage("连接成功，AI 服务已就绪。"), (reason) => setMessage(`连接失败：${errorMessage(reason)}`)).finally(() => setTesting(false)); }} type="button"><CheckCircle2 size={16} />{testing ? "测试中…" : "测试连接"}</button> : null}</div>
        </form> : null}
      </section>

      {advancedOpen ? <section className="settings-card compact diagnostics-card"><DiagnosticsPanel /></section> : null}

      <section className="settings-card compact display-settings-card">
        <div className="settings-section-heading"><Monitor size={18} /><div><strong>显示与缩放</strong><span>界面与字体独立调整，不会改变 PDF 页面缩放。</span></div></div>
        <div className="display-setting-row">
          <div><strong>界面缩放</strong><span>导航、按钮、面板、菜单与间距</span></div>
          <div aria-label="界面缩放" className="scale-options" role="group">
            {uiScaleOptions.map(([value, label]) => <button aria-pressed={uiScale === value} className={uiScale === value ? "active" : ""} key={value} onClick={() => void setUiScale(value)} title={`${label} ${value}%`} type="button"><strong>{value}%</strong><span>{label}</span></button>)}
          </div>
        </div>
        <div className="display-setting-row">
          <div><strong>字体大小</strong><span>仅调整 ScholarReader 界面文字</span></div>
          <div aria-label="字体大小" className="scale-options font-scale-options" role="group">
            {fontScaleOptions.map(([value, label]) => <button aria-pressed={fontScale === value} className={fontScale === value ? "active" : ""} key={value} onClick={() => void setFontScale(value)} title={`${label} ${value}%`} type="button"><strong>{value}%</strong><span>{label}</span></button>)}
          </div>
        </div>
        <div className="settings-actions display-reset"><button className="secondary-button" disabled={uiScale === 100 && fontScale === 100} onClick={() => void resetDisplayScale()} type="button"><RotateCw size={15} />恢复默认</button></div>
      </section>

      <section className="settings-card compact appearance-settings-card">
        <div className="settings-section-heading"><Sun size={18} /><div><strong>外观</strong><span>保持现有浅色 / 深色设计，仅调整主题主色。</span></div><Moon size={17} /></div>
        <div className="appearance-setting-row"><div><strong>明暗模式</strong><span>跟随系统或固定显示模式</span></div><div className="theme-options" role="group" aria-label="主题">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button aria-pressed={theme === value} className={theme === value ? "active" : ""} key={value} onClick={() => void setTheme(value)} type="button">{label}</button>)}</div></div>
        <div className="appearance-setting-row accent-setting"><div><strong><Palette size={15} />主题颜色</strong><span>主要按钮、活动状态与焦点高亮</span></div><div aria-label="主题颜色" className="accent-options" role="group">{accentOptions.map(([value, label]) => <button aria-label={label} aria-pressed={accent === value} className={accent === value ? "active" : ""} key={value} onClick={() => void setAccent(value)} title={label} type="button"><span className={`accent-dot ${value}`} /><span>{label}</span></button>)}</div></div>
      </section>
      <section className="settings-card compact">
        <div className="settings-section-heading"><Command size={18} /><div><strong>快捷键</strong><span>阅读器快捷操作在未聚焦输入框时生效。</span></div></div>
        <div className="shortcut-grid">{[['Ctrl + O', '添加 PDF'], ['Ctrl + F', '文档内搜索'], ['Ctrl + + / -', '放大 / 缩小'], ['Ctrl + 0', '适合宽度'], ['Alt + E', '解释选区'], ['Alt + T', '翻译选区'], ['Alt + S', '总结选区'], ['Ctrl + B', '收藏选区']].map(([keys, label]) => <div key={keys}><kbd>{keys}</kbd><span>{label}</span></div>)}</div>
      </section>
    </div>
  );
}
