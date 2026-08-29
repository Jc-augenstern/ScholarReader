const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9223/json/list";
const fixture = process.env.SCHOLARREADER_PDF_FIXTURE ?? "D:\\Codex\\Codex_Software\\tests\\fixtures\\reader-smoke-test.pdf";
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const settings = await evaluate(`window.__TAURI_INTERNALS__.invoke("get_ai_settings")`);
const providerState = await evaluate(`window.__TAURI_INTERNALS__.invoke("get_ai_provider_state", { refresh: true })`);
if (settings.provider !== "openai" || settings.hasApiKey) {
  throw new Error(`Expected legacy OpenAI without a key: ${JSON.stringify(settings)}`);
}
if (providerState.status !== "unconfigured") {
  throw new Error(`Legacy OpenAI was incorrectly considered ready: ${JSON.stringify(providerState)}`);
}

await evaluate(`location.hash = "#/settings"`);
await waitFor(`document.querySelector(".ai-settings-summary")?.innerText.includes("尚未配置")`, 10_000, "unconfigured settings UI");
const summary = await evaluate(`document.querySelector(".ai-settings-summary")?.innerText ?? ""`);
if (summary.includes("已连接") || summary.includes("已就绪")) {
  throw new Error(`Settings UI made a false connection claim: ${summary}`);
}

let documents = await evaluate(`window.__TAURI_INTERNALS__.invoke("list_documents")`);
if (!documents.length) {
  const imported = await evaluate(`window.__TAURI_INTERNALS__.invoke("import_documents", { paths: [${JSON.stringify(fixture)}] })`);
  documents = imported.imported;
}
await evaluate(`location.hash = ${JSON.stringify(`#/reader/${documents[0].id}`)}`);
await waitFor(`document.querySelector(".textLayer")?.innerText.trim().length > 10`, 30_000, "PDF text layer");
await evaluate(`(() => {
  const layer = document.querySelector(".textLayer");
  const stage = layer?.closest(".pdf-page-stage");
  if (!layer || !stage) return false;
  const range = document.createRange();
  range.selectNodeContents(layer);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  stage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  return true;
})()`);
await waitFor(`[...document.querySelectorAll("button")].some((button) => button.innerText.trim() === "解释")`, 5_000, "explain action");
await evaluate(`[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "解释").click()`);
await waitFor(`document.querySelector('[role="dialog"]')?.innerText.includes("一键启用本地 AI")`, 10_000, "AI onboarding");
const onboarding = await evaluate(`document.querySelector('[role="dialog"]')?.innerText ?? ""`);
if (await evaluate(`Boolean(document.querySelector(".ai-error"))`)) {
  throw new Error("Unexpected AI error UI");
}

const diagnostics = await evaluate(`window.__TAURI_INTERNALS__.invoke("get_diagnostics")`);
if (diagnostics.version !== "0.1.3" || diagnostics.providerStatus !== "unconfigured") {
  throw new Error(`Diagnostics do not match provider truth: ${JSON.stringify(diagnostics)}`);
}

console.log(JSON.stringify({
  stage: "legacy-openai-unconfigured",
  settings,
  providerState,
  settingsSummary: summary,
  onboarding: onboarding.split("\n").filter(Boolean),
  diagnostics,
}));
socket.close();
