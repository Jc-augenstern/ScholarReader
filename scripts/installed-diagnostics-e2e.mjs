import { stat } from "node:fs/promises";

const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9223/json/list";
const [target] = (await (await fetch(endpoint)).json()).filter((candidate) => candidate.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("ScholarReader WebView debugging target was not found");

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function invoke(command, payload = {}) {
  const result = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)})
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))`);
  if (!result.ok) throw new Error(`${command} failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

await evaluate(`location.hash = "#/settings"`);
await new Promise((resolve) => setTimeout(resolve, 750));
await evaluate(`(() => {
  const toggle = [...document.querySelectorAll("button")].find((button) => button.innerText.includes("高级设置"));
  if (toggle?.getAttribute("aria-expanded") !== "true") toggle?.click();
  return Boolean(toggle);
})()`);
await new Promise((resolve) => setTimeout(resolve, 1_500));
const state = await invoke("get_ai_provider_state", { refresh: true });
const diagnostics = await invoke("get_diagnostics");
const summary = await evaluate(`document.querySelector(".ai-settings-summary")?.innerText ?? ""`);
const pageText = await evaluate(`document.body.innerText`);
const reportPath = await invoke("export_diagnostics_report");
const report = await stat(reportPath);

if (state.provider !== "managed-local" || state.status !== "ready") {
  throw new Error(`Managed provider is not ready: ${JSON.stringify(state)}`);
}
if (diagnostics.version !== "0.1.3" || diagnostics.providerStatus !== "ready") {
  throw new Error(`Diagnostics mismatch: ${JSON.stringify(diagnostics)}`);
}
if (!summary.includes("本地 AI") || !summary.includes("已就绪")) {
  throw new Error(`Settings UI mismatch: ${summary}`);
}
if (!pageText.includes("诊断") || !pageText.includes("0.1.3") || !pageText.includes("打开日志目录") || !pageText.includes("导出诊断报告")) {
  throw new Error("Settings diagnostics panel is incomplete");
}
if (!report.isFile() || report.size === 0) throw new Error(`Diagnostics report was not exported: ${reportPath}`);

console.log(JSON.stringify({ stage: "installed-diagnostics", state, diagnostics, settingsSummary: summary, reportPath, reportBytes: report.size }));
socket.close();
