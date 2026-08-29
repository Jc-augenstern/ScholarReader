const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9224/json/list";
const mode = process.argv[2] ?? "apply";
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
  const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function invoke(command, payload = {}) {
  const result = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)})
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))`);
  if (!result.ok) throw new Error(`${command} failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openSettings() {
  await evaluate(`location.hash = "#/settings"`);
  await waitFor(`Boolean(document.querySelector('[aria-label="界面缩放"]'))`, 10_000, "display settings");
}

async function selectSetting(group, label) {
  const clicked = await evaluate(`(() => {
    const parent = document.querySelector(${JSON.stringify(`[aria-label="${group}"]`)});
    const button = [...(parent?.querySelectorAll("button") ?? [])].find((item) => item.innerText.trim().startsWith(${JSON.stringify(label)}));
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Setting option was not found: ${group} / ${label}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function layoutSnapshot() {
  return evaluate(`(() => {
    const selectors = [".topbar", ".sidebar", ".main-content", ".inspector", ".statusbar", ".settings-card", ".reader-toolbar", ".reader-search", ".reader-ai-placeholder"];
    const overflows = [];
    for (const selector of selectors) {
      for (const [index, element] of [...document.querySelectorAll(selector)].entries()) {
        if (element.scrollWidth > element.clientWidth + 2) overflows.push({ selector, index, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth });
      }
    }
    return { width: innerWidth, height: innerHeight, overflows };
  })()`);
}

if (mode === "installed-smoke") {
  const settings = await invoke("get_app_settings");
  const documents = await invoke("list_documents");
  const favorites = await invoke("list_favorites", { query: null, documentId: null });
  const tags = await invoke("list_tags");
  const aiSettings = await invoke("get_ai_settings");
  const provider = await invoke("get_ai_provider_state", { refresh: false });
  const pageLayouts = {};
  for (const route of ["library", "favorites", "tags", "settings"]) {
    await evaluate(`location.hash = ${JSON.stringify(`#/${route}`)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    pageLayouts[route] = await layoutSnapshot();
  }
  await openSettings();
  const appearance = await evaluate(`({
    theme: document.documentElement.dataset.theme ?? "system",
    accent: document.documentElement.dataset.accent,
    uiScale: document.documentElement.dataset.uiScale,
    fontScale: document.documentElement.dataset.fontScale,
  })`);
  let reader = null;
  if (documents.length) {
    const documentId = documents[0].id;
    await evaluate(`location.hash = ${JSON.stringify(`#/reader/${documentId}`)}`);
    await waitFor(`Boolean(document.querySelector(".pdf-page-stage canvas"))`, 30_000, "installed PDF canvas");
    const selected = await evaluate(`(() => {
      const layer = document.querySelector(".textLayer");
      const stage = layer?.closest(".pdf-page-stage");
      const span = [...(layer?.querySelectorAll("span") ?? [])].find((item) => item.textContent?.trim() && item.getBoundingClientRect().bottom > 0 && item.getBoundingClientRect().top < innerHeight);
      if (!span || !stage) return false;
      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      stage.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return true;
    })()`);
    if (!selected) throw new Error("No visible PDF text was available for installed selection smoke test");
    await waitFor(`Boolean(document.querySelector(".selection-toolbar"))`, 5_000, "installed selection toolbar");
    reader = await evaluate(`(() => {
      const canvas = document.querySelector(".pdf-page-stage canvas").getBoundingClientRect();
      const toolbar = document.querySelector(".selection-toolbar").getBoundingClientRect();
      return {
        zoom: document.querySelector(".zoom-readout")?.innerText,
        canvas: { width: canvas.width, height: canvas.height },
        selectionToolbarWithinViewport: toolbar.left >= 0 && toolbar.top >= 0 && toolbar.right <= innerWidth && toolbar.bottom <= innerHeight,
      };
    })()`);
    if (!reader.selectionToolbarWithinViewport) throw new Error(`Installed selection toolbar is outside the viewport: ${JSON.stringify(reader)}`);
  }
  console.log(JSON.stringify({
    stage: "installed-smoke",
    settings,
    appearance,
    data: { documentCount: documents.length, favoriteCount: favorites.length, tagCount: tags.length },
    ai: { provider: aiSettings.provider, hasApiKey: aiSettings.hasApiKey, status: provider.status },
    pageLayouts,
    reader,
    readerLayout: await layoutSnapshot(),
  }));
  socket.close();
  process.exit(0);
}

if (mode === "verify-restore") {
  const persisted = await invoke("get_app_settings");
  await openSettings();
  const appearance = await evaluate(`({
    theme: document.documentElement.dataset.theme,
    accent: document.documentElement.dataset.accent,
    uiScale: document.documentElement.dataset.uiScale,
    fontScale: document.documentElement.dataset.fontScale,
  })`);
  if (persisted.theme !== "dark" || persisted.uiScale !== 150 || persisted.fontScale !== 120 || persisted.accent !== "blue") {
    throw new Error(`Custom settings did not survive restart: ${JSON.stringify(persisted)}`);
  }
  await selectSetting("界面缩放", "100%");
  await selectSetting("字体大小", "100%");
  await selectSetting("主题颜色", "绿色");
  await selectSetting("主题", "跟随系统");
  const restored = await invoke("get_app_settings");
  console.log(JSON.stringify({ stage: "restart-persistence", persisted, appearance, restored }));
  socket.close();
  process.exit(0);
}

const initial = await invoke("get_app_settings");
await openSettings();
await selectSetting("界面缩放", "125%");
await selectSetting("字体大小", "120%");
await selectSetting("主题颜色", "蓝色");
await selectSetting("主题", "深色");
let persisted = await invoke("get_app_settings");
if (persisted.theme !== "dark" || persisted.uiScale !== 125 || persisted.fontScale !== 120 || persisted.accent !== "blue") {
  throw new Error(`Settings were not saved: ${JSON.stringify(persisted)}`);
}

let documents = await invoke("list_documents");
if (!documents.length) {
  const imported = await invoke("import_documents", { paths: [fixture] });
  documents = imported.imported;
}
if (!documents.length) throw new Error("No PDF is available for UI scale validation");
const documentId = documents[0].id;
await evaluate(`location.hash = ${JSON.stringify(`#/reader/${documentId}`)}`);
await waitFor(`Boolean(document.querySelector(".pdf-page-stage canvas"))`, 30_000, "PDF canvas");
await evaluate(`document.querySelector('button[aria-label="放大"]')?.click(); true`);
await waitFor(`document.querySelector(".save-indicator")?.classList.contains("saving")`, 5_000, "reader progress save start");
await waitFor(`document.querySelector(".save-indicator")?.classList.contains("saved")`, 10_000, "reader progress save completion");
const readerBefore = await evaluate(`(() => {
  const canvas = document.querySelector(".pdf-page-stage canvas").getBoundingClientRect();
  const toolbar = document.querySelector(".reader-toolbar").getBoundingClientRect();
  return { zoom: document.querySelector(".zoom-readout")?.innerText, canvasWidth: canvas.width, canvasHeight: canvas.height, toolbarHeight: toolbar.height };
})()`);
const savedProgress = await invoke("get_reading_progress", { documentId });
if (savedProgress?.zoomMode !== "custom" || Math.round(savedProgress.zoomValue * 100) !== Number.parseInt(readerBefore.zoom, 10)) {
  throw new Error(`PDF custom zoom was not saved before navigation: ${JSON.stringify({ savedProgress, readerBefore })}`);
}

await openSettings();
await selectSetting("界面缩放", "150%");
await evaluate(`location.hash = ${JSON.stringify(`#/reader/${documentId}`)}`);
await waitFor(`Boolean(document.querySelector(".pdf-page-stage canvas"))`, 30_000, "restored PDF canvas");
await new Promise((resolve) => setTimeout(resolve, 700));
const readerAfter = await evaluate(`(() => {
  const canvas = document.querySelector(".pdf-page-stage canvas").getBoundingClientRect();
  const toolbar = document.querySelector(".reader-toolbar").getBoundingClientRect();
  return { zoom: document.querySelector(".zoom-readout")?.innerText, canvasWidth: canvas.width, canvasHeight: canvas.height, toolbarHeight: toolbar.height };
})()`);
if (readerBefore.zoom !== readerAfter.zoom || Math.abs(readerBefore.canvasWidth - readerAfter.canvasWidth) > 1 || Math.abs(readerBefore.canvasHeight - readerAfter.canvasHeight) > 1) {
  throw new Error(`PDF custom zoom changed with UI scale: ${JSON.stringify({ readerBefore, readerAfter })}`);
}

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
await waitFor(`Boolean(document.querySelector(".selection-toolbar"))`, 5_000, "selection toolbar");
const selectionToolbar = await evaluate(`(() => {
  const toolbar = document.querySelector(".selection-toolbar");
  const rect = toolbar.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, withinViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight };
})()`);
if (!selectionToolbar.withinViewport) throw new Error(`Selection toolbar is outside the viewport: ${JSON.stringify(selectionToolbar)}`);

persisted = await invoke("get_app_settings");
const layout = await layoutSnapshot();
console.log(JSON.stringify({ stage: "ui-settings-applied", initial, persisted, readerBefore, readerAfter, selectionToolbar, layout }));
socket.close();
