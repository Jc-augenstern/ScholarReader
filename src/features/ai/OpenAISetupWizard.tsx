import { ExternalLink, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { aiGateway } from "../../platform/tauri/aiGateway";
import { useAiStore } from "../../stores/aiStore";

type Props = {
  onConnected: () => void | Promise<void>;
};

function readableError(reason: unknown): string {
  if (typeof reason === "object" && reason && "message" in reason) return String(reason.message);
  return reason instanceof Error ? reason.message : String(reason);
}

export function OpenAISetupWizard({ onConnected }: Props) {
  const current = useAiStore((state) => state.settings);
  const setSettings = useAiStore((state) => state.setSettings);
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!apiKey.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const settings = await aiGateway.saveSettings({
        provider: "openai",
        model: "gpt-4.1-mini",
        baseUrl: "https://api.openai.com/v1",
        targetLanguage: current?.targetLanguage || "中文",
        apiKey: apiKey.trim(),
        clearApiKey: false,
      });
      await aiGateway.testConnection();
      setSettings(settings);
      setApiKey("");
      await onConnected();
    } catch (reason) {
      setError(`连接未完成：${readableError(reason)}`);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <form className="openai-wizard" onSubmit={(event) => void connect(event)}>
      <h3>连接 OpenAI</h3>
      <p>使用 OpenAI 云端模型需要单独开通 OpenAI API。ChatGPT 订阅和 OpenAI API 是不同的服务。</p>
      <button className="secondary-button" onClick={() => void openUrl("https://platform.openai.com/api-keys")} type="button">
        <ExternalLink size={15} />获取 API Key
      </button>
      <ol>
        <li><span>1</span>在官方页面创建 API Key</li>
        <li><span>2</span>复制新创建的 Key</li>
        <li><span>3</span>粘贴到下方并连接</li>
      </ol>
      <label>
        API Key
        <div className="secret-input"><KeyRound size={15} /><input autoComplete="off" onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴 API Key" required type="password" value={apiKey} /></div>
      </label>
      <p className="cloud-privacy">使用云端 AI 时，你选择的文字会发送给 OpenAI 进行处理。Key 只保存在 Windows 凭据管理器中。</p>
      {error ? <div className="inline-error">{error}</div> : null}
      <button className="primary-button" disabled={connecting || !apiKey.trim()} type="submit">{connecting ? "正在连接…" : "连接"}</button>
    </form>
  );
}
