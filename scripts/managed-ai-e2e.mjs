const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9223/json/list";
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
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function clickButton(text) {
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.innerText.includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button was not found: ${text}`);
}

await waitFor(`document.body?.innerText.includes("配置 AI 阅读助手") || document.body?.innerText.includes("启用 AI 阅读助手")`, 15_000, "application start");
const onboardingAlreadyOpen = await evaluate(
  `Boolean(document.querySelector('[role="dialog"]')?.innerText.includes("一键启用本地 AI"))`,
);
if (!onboardingAlreadyOpen) {
  await clickButton(await evaluate(`document.body.innerText.includes("配置 AI 阅读助手") ? "配置 AI 阅读助手" : "启用 AI 阅读助手"`));
}
await clickButton("一键启用本地 AI");
await waitFor(`document.body.innerText.includes("首次使用需要下载 AI 模型") || document.body.innerText.includes("本地 AI 已下载")`, 10_000, "device assessment");
console.log(JSON.stringify({ stage: "assessment", dialog: await evaluate(`document.querySelector('[role="dialog"]')?.innerText`) }));
await clickButton((await evaluate(`document.body.innerText.includes("本地 AI 已下载")`)) ? "启动并测试" : "开始下载");

let lastProgress = "";
const started = Date.now();
while (Date.now() - started < 45 * 60_000) {
  const snapshot = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const bar = dialog?.querySelector('[aria-label^="下载进度"]');
    return { text: dialog?.innerText ?? "", progress: bar?.getAttribute("aria-label") ?? "" };
  })()`);
  if (snapshot.progress && snapshot.progress !== lastProgress) {
    lastProgress = snapshot.progress;
    console.log(JSON.stringify({ stage: "download", elapsedSeconds: Math.round((Date.now() - started) / 1000), progress: snapshot.progress }));
  }
  if (snapshot.text.includes("AI 阅读助手已经准备好了")) {
    console.log(JSON.stringify({ stage: "ready", elapsedSeconds: Math.round((Date.now() - started) / 1000) }));
    await clickButton("开始使用");
    socket.close();
    process.exit(0);
  }
  if (snapshot.text.includes("AI 暂时无法使用") || snapshot.text.includes("本地 AI 暂时无法启用")) {
    console.error(JSON.stringify({ stage: "error", dialog: snapshot.text }));
    socket.close();
    process.exit(2);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

socket.close();
throw new Error("Managed AI setup exceeded the 45-minute E2E timeout");
