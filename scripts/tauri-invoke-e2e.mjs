const requestedCommand = process.argv[2];
const command = requestedCommand === "--legacy-set" || requestedCommand === "--legacy-clear"
  ? "save_ai_settings"
  : requestedCommand;
const payload = requestedCommand === "--legacy-set"
  ? { input: { provider: "openai", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1", targetLanguage: "中文", apiKey: "scholarreader-temporary-e2e-credential", clearApiKey: false } }
  : requestedCommand === "--legacy-clear"
    ? { input: { provider: "openai", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1", targetLanguage: "中文", clearApiKey: true } }
    : command === "--click"
  ? (process.argv[3] ?? "")
  : process.argv[3] ? JSON.parse(process.argv[3]) : {};
if (!command) throw new Error("Usage: node scripts/tauri-invoke-e2e.mjs <command> [payload-json]");
const [target] = (await (await fetch("http://127.0.0.1:9223/json/list")).json())
  .filter((candidate) => candidate.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("ScholarReader WebView debugging target was not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
const expression = command === "--click"
  ? `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.innerText.includes(${JSON.stringify(String(payload))})); if (!button) return false; button.click(); return true; })()`
  : `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)})`;
const response = await new Promise((resolve, reject) => {
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
  }));
});
socket.close();
if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
console.log(JSON.stringify(response.result.value));
