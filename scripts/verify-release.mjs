const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const pdfPath = process.env.RELEASE_TEST_PDF ?? "D:\\Codex\\Codex_Software\\tests\\fixtures\\reader-smoke-test.pdf";
const skipImport = process.env.RELEASE_SKIP_IMPORT === "1";
const skipDiagnostic = process.env.RELEASE_SKIP_DIAGNOSTIC === "1";
const targets = await fetch(endpoint).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page");

if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No WebView page target was found at ${endpoint}`);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
let fatalRuntimeError = false;
const pending = new Map();

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    fatalRuntimeError = true;
    console.log("UNEXPECTED_EXCEPTION", JSON.stringify(message.params.exceptionDetails, null, 2));
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
await send("Runtime.enable");
await send("Page.enable");

if (!skipImport) {
  const importResult = await evaluate(`window.__TAURI_INTERNALS__.invoke("import_documents", { paths: [${JSON.stringify(pdfPath)}] })`);
  console.log("IMPORT_RESULT", JSON.stringify(importResult));
  await evaluate("setTimeout(() => window.location.reload(), 50); true");
  await wait(3000);
}
await evaluate("window.location.hash = '#/library'");
await wait(1500);
const library = JSON.parse(await evaluate(`JSON.stringify({
  fatal: Boolean(document.querySelector(".fatal-error")),
  cards: [...document.querySelectorAll(".document-card")].map((card) => card.innerText),
  bodyText: document.body.innerText,
})`));
console.log("LIBRARY", JSON.stringify(library));

const opened = await evaluate(`(() => {
  const card = [...document.querySelectorAll(".document-card")]
    .find((item) => item.innerText.includes("reader-smoke-test"));
  const link = card?.querySelector("a[href^='#/reader/']");
  if (!link) return false;
  link.click();
  return true;
})()`);
if (!opened) throw new Error("Imported PDF card could not be opened");

await wait(8000);
const reader = JSON.parse(await evaluate(`JSON.stringify({
  fatal: Boolean(document.querySelector(".fatal-error")),
  href: window.location.href,
  canvasCount: document.querySelectorAll("canvas").length,
  textLayerCount: document.querySelectorAll(".textLayer").length,
  textLayerCharacters: [...document.querySelectorAll(".textLayer")]
    .reduce((total, layer) => total + (layer.textContent?.length ?? 0), 0),
  bodyText: document.body.innerText,
})`));
console.log("READER", JSON.stringify(reader));

if (!skipDiagnostic) {
  await evaluate(`window.dispatchEvent(new ErrorEvent("error", {
    error: new Error("ScholarReader diagnostics release smoke test"),
    message: "ScholarReader diagnostics release smoke test",
  }))`);
  await wait(1500);
}

if (fatalRuntimeError || library.fatal || reader.fatal) {
  throw new Error("Release verification encountered a fatal frontend error");
}
if (library.cards.length < 2) {
  throw new Error(`Expected existing and newly imported PDFs, received ${library.cards.length}`);
}
if (reader.canvasCount < 1 || reader.textLayerCount < 1 || reader.textLayerCharacters < 1) {
  throw new Error("PDF canvas/text layer did not render");
}

console.log("VERIFY_RELEASE_OK");
socket.close();
