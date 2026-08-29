const [target] = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const fixture = "D:\\Codex\\Codex_Software\\tests\\fixtures\\reader-smoke-test.pdf";
if (!target?.webSocketDebuggerUrl) throw new Error("ScholarReader WebView debugging target was not found");
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(`${message.error.message} (${waiter.method}: ${waiter.expression})`));
  else waiter.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method, expression: String(params.expression ?? "").slice(0, 160) });
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
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const setValue = (selector, value) => `(() => {
  const field = document.querySelector(${JSON.stringify(selector)});
  if (!field) return false;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set;
  setter.call(field, ${JSON.stringify(value)});
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const settings = await evaluate(`window.__TAURI_INTERNALS__.invoke("get_ai_settings")`);
if (settings.provider !== "disabled") throw new Error("Core test requires AI to remain disabled");
let documents = await evaluate(`window.__TAURI_INTERNALS__.invoke("list_documents")`);
if (!documents.length) {
  const imported = await evaluate(`window.__TAURI_INTERNALS__.invoke("import_documents", { paths: [${JSON.stringify(fixture)}] })`);
  documents = imported.imported;
}
const documentId = documents[0].id;
await evaluate(`location.hash = ${JSON.stringify(`#/reader/${documentId}`)}`);
await waitFor(`document.querySelector('.textLayer')?.innerText.includes('Recognition rather than recall')`, 30_000, "PDF text");

await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))`);
await waitFor(`Boolean(document.querySelector('input[aria-label="搜索当前 PDF"]'))`, 3_000, "PDF search field");
await evaluate(setValue(`input[aria-label="搜索当前 PDF"]`, "Recognition"));
await waitFor(`document.querySelector('.search-results')?.innerText.includes('第 1 页')`, 15_000, "PDF search result");

await evaluate(`(() => {
  const layer = document.querySelector('.textLayer');
  const stage = layer.closest('.pdf-page-stage');
  const range = document.createRange();
  range.selectNodeContents(layer);
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  stage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
})()`);
await waitFor(`[...document.querySelectorAll('button')].some((button) => button.innerText.trim() === '收藏')`, 3_000, "favorite action");
await evaluate(`[...document.querySelectorAll('button')].find((button) => button.innerText.trim() === '收藏').click()`);
await waitFor(`document.body.innerText.includes('已加入收藏')`, 10_000, "favorite save");

await evaluate(`location.hash = '#/favorites'`);
await waitFor(`Boolean(document.querySelector('.favorite-card'))`, 10_000, "favorite card");
await evaluate(setValue(`input[aria-label="收藏标签"]`, "离线测试, 重点"));
await evaluate(setValue(`textarea[aria-label="收藏备注"]`, "AI 未启用时，备注仍能自动保存。"));
await new Promise((resolve) => setTimeout(resolve, 1_400));
const favorites = await evaluate(`window.__TAURI_INTERNALS__.invoke("list_favorites", { query: null, documentId: null })`);
if (favorites[0]?.note !== "AI 未启用时，备注仍能自动保存。" || favorites[0]?.tags?.length !== 2) {
  throw new Error(`Favorite note/tag persistence failed: ${JSON.stringify(favorites[0])}`);
}

await evaluate(setValue(`input[aria-label="搜索收藏"]`, "离线测试"));
await waitFor(`Boolean(document.querySelector('.favorite-card'))`, 5_000, "favorite search");
await evaluate(`document.querySelector('a.favorite-primary-action').click()`);
await waitFor(`Boolean(document.querySelector('.favorite-highlight.target'))`, 15_000, "return-to-source highlight");
console.log(JSON.stringify({
  stage: "core-without-ai",
  provider: settings.provider,
  pdfSearch: true,
  favoriteSaved: true,
  tags: favorites[0].tags.map((tag) => tag.name),
  note: favorites[0].note,
  returnedToSource: true
}));
socket.close();
