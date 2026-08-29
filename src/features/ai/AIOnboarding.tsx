import {
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  Languages,
  ListChecks,
  Pause,
  RotateCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ManagedAiAssessment, ManagedAiProgress, ManagedAiStatus } from "../../core/models/ai";
import { useAiStore } from "../../stores/aiStore";
import { aiServiceManager } from "./AIServiceManager";
import { OpenAISetupWizard } from "./OpenAISetupWizard";

type Step = "intro" | "download" | "progress" | "ready" | "other" | "openai";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function progressAsStatus(progress: ManagedAiProgress): ManagedAiStatus {
  return {
    ...progress,
    installed: progress.state === "starting" || progress.state === "ready",
    running: progress.state === "ready",
    technicalDetails: null,
    canPause: progress.state === "downloading-model",
    canRetry: false,
  };
}

export function AIOnboarding() {
  const open = useAiStore((state) => state.onboardingOpen);
  const close = useAiStore((state) => state.closeOnboarding);
  const finish = useAiStore((state) => state.finishOnboarding);
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("intro");
  const [assessment, setAssessment] = useState<ManagedAiAssessment | null>(null);
  const [status, setStatus] = useState<ManagedAiStatus | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlistenProgress: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    void aiServiceManager.onProgress((progress) => {
      if (!disposed) setStatus(progressAsStatus(progress));
    }).then((unlisten) => { unlistenProgress = unlisten; });
    void aiServiceManager.onStatus((next) => {
      if (!disposed) setStatus(next);
    }).then((unlisten) => { unlistenStatus = unlisten; });
    return () => {
      disposed = true;
      unlistenProgress?.();
      unlistenStatus?.();
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setStep("intro");
    setAssessment(null);
    setStatus(null);
  }, [open]);

  if (!open) return null;

  const inspectDevice = async () => {
    setChecking(true);
    try {
      const result = await aiServiceManager.assessLocalDevice();
      setAssessment(result);
      setStep("download");
    } catch (reason) {
      setStatus({
        state: "error", modelId: "", modelDisplayName: "", downloadedBytes: 0, totalBytes: 0,
        installed: false, running: false, message: "暂时无法检查本地 AI 环境", technicalDetails: String(reason), canPause: false, canRetry: true,
      });
      setStep("progress");
    } finally {
      setChecking(false);
    }
  };

  const prepare = async () => {
    setStep("progress");
    setStatus((value) => value ?? {
      state: "preparing",
      modelId: assessment?.selectedModelId ?? "",
      modelDisplayName: assessment?.selectedModelDisplayName ?? "本地 AI",
      downloadedBytes: assessment?.downloadedBytes ?? 0,
      totalBytes: assessment?.modelSizeBytes ?? 0,
      installed: false,
      running: false,
      message: "正在准备 AI 阅读助手",
      technicalDetails: null,
      canPause: true,
      canRetry: false,
    });
    try {
      const result = await aiServiceManager.prepareLocalAI();
      setStatus(result);
      if (result.state === "ready") setStep("ready");
    } catch (reason) {
      setStatus((value) => ({
        ...(value ?? progressAsStatus({ state: "error", modelId: "", modelDisplayName: "", downloadedBytes: 0, totalBytes: 0, message: "" })),
        state: "error",
        message: "AI 暂时无法使用",
        technicalDetails: String(reason),
        canPause: false,
        canRetry: true,
      }));
    }
  };

  const percentage = status?.totalBytes ? Math.min(100, Math.round(status.downloadedBytes / status.totalBytes * 100)) : 0;

  return (
    <div aria-modal="true" className="ai-onboarding-backdrop" role="dialog">
      <section className="ai-onboarding-modal">
        <button aria-label="关闭" className="modal-close" onClick={close} type="button"><X size={18} /></button>

        {step === "intro" ? <>
          <div className="onboarding-icon"><Sparkles size={26} /></div>
          <h2>启用 AI 阅读助手</h2>
          <p className="onboarding-lead">AI 可以帮助你理解正在阅读的内容。</p>
          <div className="benefit-list">
            <span><Languages size={17} />翻译论文</span>
            <span><BookOpenCheck size={17} />解释专业内容</span>
            <span><ListChecks size={17} />总结长段落</span>
          </div>
          <button className="local-ai-choice" disabled={checking} onClick={() => void inspectDevice()} type="button">
            <span className="recommend-badge">推荐</span>
            <span className="choice-title"><Sparkles size={19} />一键启用本地 AI</span>
            <small>无需账号 · 无需 API Key · 下载后可离线使用</small>
            <strong>{checking ? "正在检查设备…" : "一键启用"}<ChevronRight size={16} /></strong>
          </button>
          <button className="other-ai-link" onClick={() => setStep("other")} type="button">其他 AI 服务 <ChevronRight size={15} /></button>
        </> : null}

        {step === "download" && assessment ? <>
          <div className="onboarding-icon"><Download size={26} /></div>
          <h2>{assessment.installed ? "本地 AI 已下载" : "首次使用需要下载 AI 模型"}</h2>
          <p className="onboarding-lead">{assessment.installed ? "点击后将启动并测试 AI 阅读助手。" : `预计大小 ${formatBytes(assessment.modelSizeBytes)}，下载一次后可离线使用。`}</p>
          <div className="local-privacy"><ShieldCheck size={20} /><div><strong>选中文字只在你的电脑上处理</strong><span>不会发送到云端，也不会影响 PDF、收藏或阅读数据。</span></div></div>
          {!assessment.diskSpaceSufficient ? <div className="inline-error">磁盘空间不足，请释放至少 {formatBytes(assessment.modelSizeBytes - assessment.downloadedBytes)} 后重试。</div> : null}
          <div className="onboarding-actions">
            <button className="secondary-button" onClick={() => setStep("intro")} type="button"><ChevronLeft size={15} />返回</button>
            <button className="primary-button" disabled={!assessment.supported || !assessment.diskSpaceSufficient} onClick={() => void prepare()} type="button">{assessment.installed ? "启动并测试" : "开始下载"}</button>
          </div>
        </> : null}

        {step === "progress" && status ? <>
          <div className="onboarding-icon"><Download size={26} /></div>
          <h2>{status.message || "正在准备 AI 阅读助手"}</h2>
          {status.state !== "error" ? <>
            <div aria-label={`下载进度 ${percentage}%`} className="download-progress"><span style={{ width: `${percentage}%` }} /></div>
            <div className="download-numbers"><strong>{percentage}%</strong><span>{formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)}</span></div>
            <p className="onboarding-lead">你可以继续阅读 PDF，准备过程不会阻塞其他功能。</p>
          </> : <>
            <p className="onboarding-lead">可以重试；PDF、收藏和阅读数据不会受到影响。</p>
            {status.technicalDetails ? <details><summary>查看详细信息</summary><pre>{status.technicalDetails}</pre></details> : null}
          </>}
          <div className="onboarding-actions">
            {status.canPause ? <button className="secondary-button" onClick={() => void aiServiceManager.pauseSetup()} type="button"><Pause size={15} />暂停</button> : null}
            {status.state === "paused" || status.state === "error" ? <button className="primary-button" onClick={() => void prepare()} type="button"><RotateCw size={15} />重试</button> : null}
            {status.state !== "error" ? <button className="text-button" onClick={() => { void aiServiceManager.cancelSetup(); setStep("intro"); }} type="button">取消</button> : null}
          </div>
        </> : null}

        {step === "ready" ? <>
          <div className="onboarding-icon success"><Check size={28} /></div>
          <h2>AI 阅读助手已经准备好了</h2>
          <p className="onboarding-lead">现在可以直接使用翻译、解释和总结。</p>
          <div className="local-privacy"><ShieldCheck size={20} /><div><strong>本地 AI</strong><span>选中的文字只在你的电脑上处理，不会发送到云端。</span></div></div>
          <button className="primary-button onboarding-primary" onClick={() => void finish()} type="button">开始使用</button>
        </> : null}

        {step === "other" ? <>
          <div className="onboarding-icon"><Cloud size={26} /></div>
          <h2>其他 AI 服务</h2>
          <p className="onboarding-lead">这些选项适合已经拥有云端 API 或本地模型服务的用户。</p>
          <button className="service-choice" onClick={() => setStep("openai")} type="button"><span><strong>OpenAI</strong><small>使用自己的 OpenAI API Key</small></span><ChevronRight size={17} /></button>
          <button className="service-choice" onClick={() => { close(); void navigate("/settings"); }} type="button"><span><strong>Ollama 或兼容服务</strong><small>在高级设置中配置</small></span><ChevronRight size={17} /></button>
          <button className="other-ai-link" onClick={() => setStep("intro")} type="button"><ChevronLeft size={15} />返回推荐方式</button>
        </> : null}

        {step === "openai" ? <>
          <OpenAISetupWizard onConnected={() => setStep("ready")} />
          <button className="other-ai-link" onClick={() => setStep("other")} type="button"><ChevronLeft size={15} />返回</button>
        </> : null}
      </section>
    </div>
  );
}
