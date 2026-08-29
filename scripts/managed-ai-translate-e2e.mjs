const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9223/json/list";
const fixture = process.env.SCHOLARREADER_PDF_FIXTURE ?? "D:\\Codex\\Codex_Software\\tests\\fixtures\\reader-smoke-test.pdf";
const action = process.argv[2] ?? "translate";
const actionLabel = { explain: "解释", translate: "翻译", summarize: "总结" }[action];
if (!actionLabel) throw new Error(`Unsupported AI action: ${action}`);
const [target] = await (await fetch(endpoint)).json();
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
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const settings = await evaluate(`window.__TAURI_INTERNALS__.invoke("get_ai_settings")`);
if (settings.provider !== "managed-local") throw new Error(`Managed provider is not active: ${JSON.stringify(settings)}`);
console.log(JSON.stringify({ stage: "settings", provider: settings.provider, model: settings.model }));

let documents = await evaluate(`window.__TAURI_INTERNALS__.invoke("list_documents")`);
if (!documents.length) {
  const summary = await evaluate(`window.__TAURI_INTERNALS__.invoke("import_documents", { paths: [${JSON.stringify(fixture)}] })`);
  if (!summary.imported?.length) throw new Error(`PDF import failed: ${JSON.stringify(summary)}`);
  documents = summary.imported;
}
const document = documents[0];
await evaluate(`document.querySelector('button[aria-label="关闭 AI 结果"]')?.click(); true`);
await evaluate(`location.hash = "#/library"`);
await waitFor(`location.hash === "#/library" && !document.querySelector('.ai-output')`, 5_000, "clean library route");
await evaluate(`location.hash = ${JSON.stringify(`#/reader/${document.id}`)}`);
await waitFor(`document.querySelector('.textLayer')?.innerText.trim().length > 10`, 30_000, "PDF text layer");

const selectedText = await evaluate(`(() => {
  const layer = document.querySelector('.textLayer');
  const stage = layer?.closest('.pdf-page-stage');
  if (!layer || !stage) return "";
  const range = document.createRange();
  range.selectNodeContents(layer);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  stage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  return selection.toString().trim();
})()`);
if (!selectedText) throw new Error("PDF text selection could not be created");
await waitFor(`[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === ${JSON.stringify(actionLabel)})`, 5_000, "selection toolbar");
await evaluate(`[...document.querySelectorAll('button')].find((button) => button.innerText.trim() === ${JSON.stringify(actionLabel)}).click()`);
await waitFor(`Boolean(document.querySelector('.ai-output')) || Boolean(document.querySelector('.ai-error'))`, 180_000, `AI ${action}`);

const outcome = await evaluate(`({
  output: document.querySelector('.ai-output')?.innerText ?? "",
  error: document.querySelector('.ai-error')?.innerText ?? "",
  pageText: document.querySelector('.textLayer')?.innerText ?? ""
})`);
console.log(JSON.stringify({ stage: action, selectedText: selectedText.slice(0, 240), ...outcome }));
socket.close();
if (!outcome.output || outcome.error) process.exit(2);
