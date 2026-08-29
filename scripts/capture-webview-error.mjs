const endpoint = process.env.CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const targets = await fetch(endpoint).then((response) => response.json());
const target = targets.find((entry) => entry.type === "page");

if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No WebView page target was found at ${endpoint}`);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    console.log("EXCEPTION_THROWN");
    console.log(JSON.stringify(message.params.exceptionDetails, null, 2));
  }
  if (message.method === "Runtime.consoleAPICalled") {
    console.log(`CONSOLE_${message.params.type.toUpperCase()}`);
    console.log(JSON.stringify(message.params, null, 2));
  }
  if (message.method === "Log.entryAdded") {
    console.log("LOG_ENTRY");
    console.log(JSON.stringify(message.params.entry, null, 2));
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

const navigation = await send("Runtime.evaluate", {
  expression: "window.location.hash = '#/'; window.location.href",
  returnByValue: true,
});
console.log("NAVIGATION", JSON.stringify(navigation));

await wait(500);

const click = await send("Runtime.evaluate", {
  expression: `(() => {
    const link = [...document.querySelectorAll("a")].find((item) => item.getAttribute("href") === "#/library");
    if (!link) return "library link not found";
    link.click();
    return "library link clicked";
  })()`,
  returnByValue: true,
});
console.log("CLICK", JSON.stringify(click));

await wait(500);

const openDocument = await send("Runtime.evaluate", {
  expression: `(() => {
    const link = [...document.querySelectorAll("a")].find((item) => item.getAttribute("href")?.startsWith("#/reader/"));
    if (!link) return "reader link not found";
    link.click();
    return "reader link clicked";
  })()`,
  returnByValue: true,
});
console.log("OPEN_DOCUMENT", JSON.stringify(openDocument));

await wait(5000);

const snapshot = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    href: window.location.href,
    title: document.title,
    bodyText: document.body.innerText,
    htmlClass: document.documentElement.className,
  })`,
  returnByValue: true,
});
console.log("SNAPSHOT", snapshot.result?.value);

socket.close();
