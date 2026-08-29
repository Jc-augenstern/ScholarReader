import http from "node:http";

const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9223/json/list";
const temporaryKey = "scholarreader-openai-mock-e2e-key";
const received = [];
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    received.push({
      method: request.method,
      url: request.url,
      authorized: request.headers.authorization === `Bearer ${temporaryKey}`,
      bodyLength: chunks.reduce((total, chunk) => total + chunk.length, 0),
    });
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/v1/models") {
      response.end(JSON.stringify({ object: "list", data: [{ id: "scholarreader-e2e" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const prompt = payload.messages?.at(-1)?.content ?? "";
      const action = prompt.startsWith("Explain") ? "explain" : prompt.startsWith("Translate") ? "translate" : "summarize";
      response.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: `Mock OpenAI ${action} succeeded` } }],
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/v1`;

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

let restored = false;
try {
  const settings = await invoke("save_ai_settings", {
    input: {
      provider: "openai",
      model: "scholarreader-e2e",
      baseUrl,
      targetLanguage: "中文",
      apiKey: temporaryKey,
      clearApiKey: false,
    },
  });
  const provider = await invoke("get_ai_provider_state", { refresh: true });
  if (!settings.hasApiKey || provider.status !== "ready") {
    throw new Error(`OpenAI mock did not become ready: ${JSON.stringify({ settings, provider })}`);
  }

  await evaluate(`location.hash = "#/library"`);
  await evaluate(`location.hash = "#/settings"`);
  await waitFor(`document.querySelector(".ai-settings-summary")?.innerText.includes("OpenAI") && document.querySelector(".ai-settings-summary")?.innerText.includes("已就绪")`, 10_000, "ready OpenAI settings UI");
  const settingsSummary = await evaluate(`document.querySelector(".ai-settings-summary")?.innerText ?? ""`);

  const outputs = {};
  for (const action of ["explain", "translate", "summarize"]) {
    const result = await invoke("run_ai_action", {
      input: {
        requestId: `openai-mock-${action}-${Date.now()}`,
        action,
        text: "A short academic sentence for provider routing verification.",
        context: null,
        targetLanguage: "中文",
      },
    });
    if (result.provider !== "openai" || !result.content.includes(action)) {
      throw new Error(`Unexpected ${action} result: ${JSON.stringify(result)}`);
    }
    outputs[action] = result.content;
  }
  if (received.length < 7 || received.some((request) => !request.authorized)) {
    throw new Error(`OpenAI requests failed authorization/routing checks: ${JSON.stringify(received)}`);
  }

  await invoke("save_ai_settings", {
    input: {
      provider: "disabled",
      model: "scholarreader-e2e",
      baseUrl: "",
      targetLanguage: "中文",
      clearApiKey: true,
    },
  });
  const managed = await invoke("prepare_managed_ai");
  const restoredProvider = await invoke("get_ai_provider_state", { refresh: true });
  restored = managed.state === "ready" && restoredProvider.provider === "managed-local" && restoredProvider.status === "ready";
  if (!restored) throw new Error(`Could not restore managed provider: ${JSON.stringify({ managed, restoredProvider })}`);

  console.log(JSON.stringify({
    stage: "openai-ready-and-routed",
    provider,
    settingsSummary,
    outputs,
    requests: received.map(({ method, url, authorized, bodyLength }) => ({ method, url, authorized, bodyLength })),
    managedProviderRestored: restored,
  }));
} finally {
  if (!restored) {
    await invoke("save_ai_settings", {
      input: { provider: "disabled", model: "gpt-4.1-mini", baseUrl: "", targetLanguage: "中文", clearApiKey: true },
    }).catch(() => undefined);
  }
  socket.close();
  await new Promise((resolve) => server.close(resolve));
}
