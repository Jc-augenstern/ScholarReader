import { Check, Copy, RefreshCw, Sparkles, Star, X } from "lucide-react";
import { useState } from "react";
import { favoriteGateway } from "../../platform/tauri/favoriteGateway";
import { useAiStore } from "../../stores/aiStore";

const actionLabels = { explain: "解释", translate: "翻译", summarize: "总结" } as const;
const providerLabels = { "managed-local": "本地 AI", openai: "OpenAI", ollama: "Ollama", custom: "兼容 AI", disabled: "可选增强" } as const;

export function AIInspector() {
  const settings = useAiStore((state) => state.settings);
  const providerState = useAiStore((state) => state.providerState);
  const context = useAiStore((state) => state.context);
  const output = useAiStore((state) => state.output);
  const error = useAiStore((state) => state.error);
  const status = useAiStore((state) => state.status);
  const regenerate = useAiStore((state) => state.regenerate);
  const cancel = useAiStore((state) => state.cancel);
  const clear = useAiStore((state) => state.clear);
  const openOnboarding = useAiStore((state) => state.openOnboarding);
  const [favoriteSaved, setFavoriteSaved] = useState(false);

  return (
    <section className="inspector-card ai-card ai-assistant">
      <div className="inspector-heading">
        <Sparkles size={17} />
        <span>AI 阅读助手</span>
        {context ? <button aria-label="关闭 AI 结果" className="inspector-close" onClick={clear} type="button"><X size={14} /></button> : null}
      </div>
      {!context ? (
        <>
          <p>{providerState?.status === "ready" ? "选择 PDF 文字后，可进行解释、翻译或总结。" : providerState?.message ?? "需要时可一键启用 AI；PDF 阅读和收藏始终可以独立使用。"}</p>
          <span className={`status-pill ${providerState?.status === "ready" ? "ready" : "neutral"}`}>
            {settings?.provider ? `${providerLabels[settings.provider]} · ${providerState?.status === "ready" ? "已就绪" : providerState?.status === "checking" ? "检查中" : "未配置"}` : "可选增强"}
          </span>
          {providerState && (providerState.status === "disabled" || providerState.status === "unconfigured") ? <button className="ai-enable-link" onClick={openOnboarding} type="button">配置 AI 阅读助手</button> : null}
        </>
      ) : (
        <>
          <span className="ai-action-label">当前操作 · {actionLabels[context.action]}</span>
          <div className="ai-source-text">“{context.selection.selectedText}”</div>
          {status === "loading" ? (
            <div className="ai-loading"><span className="spinner dark" />正在{actionLabels[context.action]}…<button onClick={() => void cancel()} type="button">取消</button></div>
          ) : null}
          {error ? <div className="ai-error"><p>{error}</p></div> : null}
          {output ? <div className="ai-output">{output}</div> : null}
          {(output || status === "cancelled") ? (
            <div className="ai-result-actions">
              {output ? <button onClick={() => void navigator.clipboard.writeText(output)} type="button"><Copy size={14} />复制</button> : null}
              <button onClick={() => void regenerate()} type="button"><RefreshCw size={14} />重新生成</button>
              <button
                onClick={() => {
                  void favoriteGateway.create(context.selection).then((favorite) => {
                    window.dispatchEvent(new CustomEvent("scholar:favorite-created", { detail: favorite }));
                    setFavoriteSaved(true);
                    window.setTimeout(() => setFavoriteSaved(false), 1600);
                  });
                }}
                type="button"
              >{favoriteSaved ? <Check size={14} /> : <Star size={14} />}{favoriteSaved ? "已收藏原文" : "收藏原文"}</button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
