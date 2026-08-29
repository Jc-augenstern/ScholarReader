import { mkdir, writeFile } from "node:fs/promises";

const endpoint = process.env.SCHOLARREADER_CDP_URL ?? "http://127.0.0.1:9226/json/list";
const fixture = process.env.SCHOLARREADER_PDF_FIXTURE ?? "D:\\Codex\\Codex_Software\\tests\\fixtures\\selection-acceptance.pdf";
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

async function invoke(command, payload = {}) {
  const result = await evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(payload)})
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }))`);
  if (!result.ok) throw new Error(`${command} failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function captureScreenshot(name) {
  const directory = "D:\\Codex\\Codex_Software\\tmp\\refactor-acceptance";
  await mkdir(directory, { recursive: true });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = `${directory}\\${name}.png`;
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
  return path;
}

async function waitFor(expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function route(path, readyExpression) {
  await evaluate(`location.hash = ${JSON.stringify(`#/${path}`)}`);
  try {
    await waitFor(readyExpression, 20_000, path || "home");
  } catch (error) {
    const debug = await evaluate(`({ hash: location.hash, body: document.body.innerText.slice(0, 1200), textLayer: document.querySelector(".textLayer")?.innerText ?? null })`);
    throw new Error(`${error.message}: ${JSON.stringify(debug)}`);
  }
}

async function textPoint(substring, characterOffset, edge) {
  const value = await evaluate(`(() => {
    const layer = document.querySelector(".textLayer");
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) nodes.push(current);
    const ordered = [...nodes.filter((node) => node.data === ${JSON.stringify(substring)}), ...nodes.filter((node) => node.data !== ${JSON.stringify(substring)})];
    for (const node of ordered) {
      const base = node.data.indexOf(${JSON.stringify(substring)});
      if (base < 0) continue;
      const index = base + ${characterOffset};
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      return {
        x: ${JSON.stringify(edge)} === "left" ? rect.left + 1 : rect.right - 1,
        y: (rect.top + rect.bottom) / 2,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        text: node.data,
      };
    }
    return null;
  })()`);
  if (!value) throw new Error(`Text point not found: ${substring} / ${characterOffset}`);
  return value;
}

async function drag(start, end) {
  await evaluate(`window.getSelection()?.removeAllRanges()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: start.x + ((end.x - start.x) * step) / 8,
      y: start.y + ((end.y - start.y) * step) / 8,
      button: "left",
      buttons: 1,
    });
  }
  const rawSelection = await evaluate(`window.getSelection()?.toString() ?? ""`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", buttons: 0, clickCount: 1 });
  await delay(250);
  const snappedSelection = await evaluate(`window.getSelection()?.toString() ?? ""`);
  return { rawSelection, snappedSelection };
}

async function runAiSelectionAction(label, start, end) {
  const selection = await drag(start, end);
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll(".selection-toolbar button")]
      .find((item) => item.innerText.trim() === ${JSON.stringify(label)});
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Selection action was not found: ${label}`);
  await waitFor(`Boolean(document.querySelector(".ai-source-text"))`, 10_000, `${label} source text`);
  const sourceText = await evaluate(`document.querySelector(".ai-source-text").innerText`);
  await evaluate(`document.querySelector(".inspector-close")?.click()`);
  await waitFor(`!document.querySelector(".ai-source-text")`, 5_000, `${label} inspector close`);
  return { ...selection, sourceText };
}

const themeLabels = { system: "跟随系统", light: "浅色", dark: "深色" };
const accentLabels = { green: "绿色", blue: "蓝色", cyan: "青色", purple: "紫色", orange: "橙色", red: "红色", pink: "粉色" };

async function setAppearance(theme, accent) {
  await route("settings", `Boolean(document.querySelector(".theme-options"))`);
  const themeClicked = await evaluate(`(() => {
    const themeButton = [...document.querySelectorAll(".theme-options button")]
      .find((button) => button.innerText.includes(${JSON.stringify(themeLabels[theme])}));
    themeButton?.click();
    return Boolean(themeButton);
  })()`);
  if (!themeClicked) throw new Error(`Theme control was not found: ${theme}`);
  await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, 5_000, `${theme} theme`);
  await delay(180);
  const accentClicked = await evaluate(`(() => {
    const accentButton = [...document.querySelectorAll(".accent-options button")]
      .find((button) => button.innerText.includes(${JSON.stringify(accentLabels[accent])}));
    accentButton?.click();
    return Boolean(accentButton);
  })()`);
  if (!accentClicked) throw new Error(`Accent control was not found: ${accent}`);
  await waitFor(
    `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && document.documentElement.dataset.accent === ${JSON.stringify(accent)}`,
    5_000,
    `${theme}/${accent} appearance`,
  );
  await delay(180);
}

async function appearanceSnapshot(theme, accent) {
  await setAppearance(theme, accent);
  await route("", `Boolean(document.querySelector(".welcome-panel"))`);
  const snapshot = await evaluate(`(() => {
    const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo);
    const root = getComputedStyle(document.documentElement);
    const read = (selector) => ({
      backgroundColor: style(selector).backgroundColor,
      backgroundImage: style(selector).backgroundImage,
      color: style(selector).color,
      borderColor: style(selector).borderColor,
    });
    const thumb = style(".main-content", "::-webkit-scrollbar-thumb");
    const track = style(".main-content", "::-webkit-scrollbar-track");
    return {
      theme: document.documentElement.dataset.theme,
      accent: document.documentElement.dataset.accent,
      tokens: {
        accent: root.getPropertyValue("--accent").trim(),
        accentSoft: root.getPropertyValue("--accent-soft").trim(),
        accentRgb: root.getPropertyValue("--accent-rgb").trim(),
        canvas: root.getPropertyValue("--canvas").trim(),
        panel: root.getPropertyValue("--panel").trim(),
      },
      main: read(".app-shell"),
      sidebar: read(".sidebar"),
      topbar: read(".topbar"),
      welcome: read(".welcome-panel"),
      welcomeTitle: read(".welcome-panel h1"),
      welcomeSubtitle: read(".welcome-panel p"),
      scrollbar: { thumb: thumb.backgroundColor, track: track.backgroundColor },
      stylesheets: [...document.styleSheets].map((sheet) => sheet.href ?? "inline"),
    };
  })()`);
  if ((theme === "light" && accent === "blue") || (theme === "dark" && ["purple", "green"].includes(accent))) {
    snapshot.screenshot = await captureScreenshot(`${theme}-${accent}-home`);
  }
  return snapshot;
}

let createdDocumentId = null;
const originalSettings = await invoke("get_app_settings");
const output = { selection: {}, themes: {}, diagnostics: null, motion: null };

try {
  const imported = await invoke("import_documents", { paths: [fixture] });
  if (imported.failed.length) throw new Error(`QA PDF import failed: ${JSON.stringify(imported.failed)}`);
  const document = imported.imported[0] ?? (await invoke("list_documents")).find((item) => item.filepath === fixture);
  if (!document) throw new Error("QA PDF document could not be resolved after import");
  if (imported.imported.length) createdDocumentId = document.id;

  await route(`reader/${document.id}`, `document.querySelector(".textLayer")?.textContent.includes("interaction") && document.querySelector(".textLayer")?.textContent.includes("智能交互设计")`);
  await evaluate(`document.querySelector(".reader-viewport").scrollTop = 0`);
  await delay(300);
  output.selection.textNodes = await evaluate(`[...document.querySelectorAll(".textLayer span")].map((span) => span.textContent)`);

  const partialStart = await textPoint("The inter", 6, "left");
  const partialEnd = await textPoint("action", 2, "right");
  output.selection.singleWord = await drag(partialStart, partialEnd);
  if (output.selection.singleWord.rawSelection !== "teract" || output.selection.singleWord.snappedSelection !== "interaction") {
    throw new Error(`Single-word snap mismatch: ${JSON.stringify({ result: output.selection.singleWord, textNodes: output.selection.textNodes })}`);
  }
  output.selection.toolbarMotion = await evaluate(`(() => {
    const toolbar = getComputedStyle(document.querySelector(".selection-toolbar"));
    const button = getComputedStyle(document.querySelector(".selection-toolbar button"));
    return { animationName: toolbar.animationName, animationDuration: toolbar.animationDuration, buttonTransition: button.transitionDuration };
  })()`);
  if (output.selection.toolbarMotion.animationName !== "selection-toolbar-enter") {
    throw new Error(`Selection Toolbar animation is not applied: ${JSON.stringify(output.selection.toolbarMotion)}`);
  }

  await evaluate(`window.__qaCopiedSelection = null; document.body.focus(); document.addEventListener("copy", () => { window.__qaCopiedSelection = window.getSelection()?.toString() ?? ""; }, { once: true })`);
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, modifiers: 2, commands: ["Copy"] });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, modifiers: 2 });
  output.selection.ctrlCopy = await evaluate(`window.__qaCopiedSelection`);
  if (output.selection.ctrlCopy !== "interaction") throw new Error(`Ctrl+C received stale text: ${output.selection.ctrlCopy}`);

  await evaluate(`(() => { const button = [...document.querySelectorAll(".selection-toolbar button")].find((item) => item.innerText.trim() === "收藏"); button?.click(); return Boolean(button); })()`);
  await waitFor(`!document.querySelector(".selection-toolbar")`, 5_000, "favorite selection action");
  const favorites = await invoke("list_favorites", { query: null, documentId: document.id });
  output.selection.favoriteText = favorites[0]?.selectedText ?? null;
  if (output.selection.favoriteText !== "interaction") throw new Error(`Favorite received stale text: ${output.selection.favoriteText}`);

  const multiStart = await textPoint("The inter", 8, "left");
  const multiRaw = "technique significantly impro";
  const multiEnd = await textPoint(multiRaw, multiRaw.length - 1, "right");
  output.selection.multiWord = await drag(multiStart, multiEnd);
  if (
    output.selection.multiWord.rawSelection.trim() !== "raction technique significantly impro" ||
    output.selection.multiWord.snappedSelection.trim() !== "interaction technique significantly improves"
  ) throw new Error(`Multi-word snap mismatch: ${JSON.stringify(output.selection.multiWord)}`);

  output.selection.aiActions = {};
  for (const label of ["解释", "翻译", "总结"]) {
    const result = await runAiSelectionAction(label, multiStart, multiEnd);
    if (!result.sourceText.includes("interaction technique significantly improves")) {
      throw new Error(`${label} received stale text: ${JSON.stringify(result)}`);
    }
    output.selection.aiActions[label] = result;
  }

  const chineseStart = await textPoint("智能交互设计", 2, "left");
  const chineseEnd = await textPoint("智能交互设计", 3, "right");
  output.selection.chinese = await drag(chineseStart, chineseEnd);
  if (output.selection.chinese.rawSelection !== "交互" || output.selection.chinese.snappedSelection !== "交互") {
    throw new Error(`Chinese selection changed: ${JSON.stringify(output.selection.chinese)}`);
  }

  const line = await evaluate(`(() => {
    const spans = [...document.querySelectorAll(".textLayer span")];
    const first = spans.find((span) => span.textContent.startsWith("The ")).getBoundingClientRect();
    const last = spans.find((span) => span.textContent.includes("usability.")).getBoundingClientRect();
    return {
      first: { left: first.left, y: (first.top + first.bottom) / 2 },
      last: { right: last.right, y: (last.top + last.bottom) / 2 },
    };
  })()`);
  const interactionEnd = await textPoint("action", 5, "right");
  output.selection.hitSlopStart = await drag({ x: line.first.left - 6, y: line.first.y }, interactionEnd);
  const improvesStart = await textPoint(" improves", 1, "left");
  output.selection.hitSlopEnd = await drag(improvesStart, { x: line.last.right + 6, y: line.last.y });
  output.selection.farOutside = await drag({ x: line.first.left - 18, y: line.first.y }, interactionEnd);
  if (!output.selection.hitSlopStart.snappedSelection.startsWith("The interaction")) {
    throw new Error(`Left hit slop failed: ${JSON.stringify(output.selection.hitSlopStart)}`);
  }
  if (!output.selection.hitSlopEnd.snappedSelection.endsWith("improves usability.")) {
    throw new Error(`Right hit slop failed: ${JSON.stringify(output.selection.hitSlopEnd)}`);
  }
  if (output.selection.farOutside.snappedSelection) {
    throw new Error(`Distant pointer incorrectly selected text: ${JSON.stringify(output.selection.farOutside)}`);
  }

  for (const [theme, accent] of [["light", "blue"], ["light", "purple"], ["dark", "blue"], ["dark", "purple"], ["dark", "green"]]) {
    output.themes[`${theme}-${accent}`] = await appearanceSnapshot(theme, accent);
  }
  const heroBackgrounds = Object.values(output.themes).map((item) => item.welcome.backgroundImage);
  if (new Set(heroBackgrounds).size !== heroBackgrounds.length) throw new Error("Welcome Hero did not change for every tested appearance");
  for (const [name, snapshot] of Object.entries(output.themes)) {
    if (name.startsWith("dark-") && snapshot.main.backgroundColor !== "rgb(20, 21, 22)") {
      throw new Error(`Dark main background is not neutral for ${name}: ${snapshot.main.backgroundColor}`);
    }
    if (!snapshot.sidebar.backgroundImage.includes("linear-gradient") || !snapshot.topbar.backgroundImage.includes("linear-gradient")) {
      throw new Error(`Theme chrome tint is missing for ${name}`);
    }
    if (!snapshot.scrollbar.thumb || snapshot.scrollbar.thumb === "rgba(0, 0, 0, 0)") {
      throw new Error(`Scrollbar thumb is not themed for ${name}`);
    }
  }

  await setAppearance("dark", "purple");
  await route("settings", `Boolean(document.querySelector(".advanced-toggle"))`);
  await evaluate(`document.querySelector(".advanced-toggle").click()`);
  await waitFor(`Boolean(document.querySelector(".diagnostics-card .diagnostics-panel"))`, 10_000, "diagnostics panel");
  output.diagnostics = await evaluate(`(() => {
    const advanced = document.querySelector(".advanced-settings-card").getBoundingClientRect();
    const diagnostics = document.querySelector(".diagnostics-card").getBoundingClientRect();
    const actions = document.querySelector(".diagnostics-panel .settings-actions");
    const buttons = [...actions.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { text: button.innerText.trim(), left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      advanced: { left: advanced.left, width: advanced.width },
      diagnostics: { left: diagnostics.left, width: diagnostics.width },
      actions: { scrollWidth: actions.scrollWidth, clientWidth: actions.clientWidth, buttons },
    };
  })()`);
  if (
    Math.abs(output.diagnostics.advanced.left - output.diagnostics.diagnostics.left) > 0.5 ||
    Math.abs(output.diagnostics.advanced.width - output.diagnostics.diagnostics.width) > 0.5 ||
    output.diagnostics.actions.scrollWidth > output.diagnostics.actions.clientWidth + 1
  ) throw new Error(`Diagnostics alignment failed: ${JSON.stringify(output.diagnostics)}`);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  await evaluate(`document.querySelector(".diagnostics-card").scrollIntoView({ block: "center" })`);
  await delay(180);
  output.diagnostics.narrow = await evaluate(`(() => {
    const actions = document.querySelector(".diagnostics-panel .settings-actions");
    const buttons = [...actions.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { text: button.innerText.trim(), top: rect.top, width: rect.width };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: actions.scrollWidth,
      clientWidth: actions.clientWidth,
      rowCount: new Set(buttons.map((button) => Math.round(button.top))).size,
      buttons,
    };
  })()`);
  output.diagnostics.narrow.screenshot = await captureScreenshot("narrow-diagnostics");
  await cdp("Emulation.clearDeviceMetricsOverride");
  if (
    output.diagnostics.narrow.scrollWidth > output.diagnostics.narrow.clientWidth + 1 ||
    output.diagnostics.narrow.rowCount < 2
  ) throw new Error(`Diagnostics narrow layout failed: ${JSON.stringify(output.diagnostics.narrow)}`);
  const diagnostics = await invoke("get_diagnostics");
  const reportPath = await invoke("export_diagnostics_report");
  output.diagnostics.runtime = { version: diagnostics.version, reportPath };
  if (diagnostics.version !== "0.1.3") throw new Error(`Diagnostics version mismatch: ${diagnostics.version}`);

  await route("library", `Boolean(document.querySelector(".library-toolbar"))`);
  output.motion = await evaluate(`(() => {
    const primary = getComputedStyle(document.querySelector(".primary-button"));
    const nav = getComputedStyle(document.querySelector(".nav-item"));
    return { primaryTransition: primary.transitionDuration, navTransition: nav.transitionDuration };
  })()`);
  if (!output.motion.primaryTransition.includes("0.12") || !output.motion.navTransition.includes("0.18")) {
    throw new Error(`Expected motion rules are not applied: ${JSON.stringify(output.motion)}`);
  }
  await evaluate(`document.querySelector(".document-menu summary")?.click()`);
  await waitFor(`Boolean(document.querySelector(".menu-popover"))`, 5_000, "document menu popover");
  output.motion.menu = await evaluate(`(() => { const style = getComputedStyle(document.querySelector(".menu-popover")); return { animationName: style.animationName, animationDuration: style.animationDuration }; })()`);
  if (output.motion.menu.animationName !== "surface-enter") throw new Error(`Menu animation is not applied: ${JSON.stringify(output.motion.menu)}`);
  await evaluate(`document.querySelector(".document-menu summary")?.click()`);
  const primaryRect = await evaluate(`(() => { const rect = document.querySelector(".primary-button").getBoundingClientRect(); return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }; })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: primaryRect.x, y: primaryRect.y });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: primaryRect.x, y: primaryRect.y, button: "left", buttons: 1, clickCount: 1 });
  await delay(100);
  output.motion.primaryActiveTransform = await evaluate(`getComputedStyle(document.querySelector(".primary-button")).transform`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: primaryRect.x - 280, y: primaryRect.y + 100, button: "left", buttons: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: primaryRect.x - 280, y: primaryRect.y + 100, button: "left", buttons: 0, clickCount: 1 });
  if (!output.motion.primaryActiveTransform.startsWith("matrix(") || output.motion.primaryActiveTransform === "matrix(1, 0, 0, 1, 0, 0)") {
    throw new Error(`Primary button active transform is not visible: ${output.motion.primaryActiveTransform}`);
  }
  await cdp("Emulation.setEmulatedMedia", { media: "screen", features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  output.motion.reduced = await evaluate(`getComputedStyle(document.querySelector(".nav-item")).transitionDuration`);
  await cdp("Emulation.setEmulatedMedia", { media: "screen", features: [] });
  if (Number.parseFloat(output.motion.reduced) > 0.00002) throw new Error(`Reduced motion override is missing: ${output.motion.reduced}`);
} finally {
  try {
    await setAppearance(originalSettings.theme, originalSettings.accent);
  } catch {}
  if (createdDocumentId) {
    try {
      await route("", `Boolean(document.querySelector(".welcome-panel"))`);
      await invoke("remove_document", { id: createdDocumentId });
    } catch {}
  }
  socket.close();
}

console.log(JSON.stringify(output));
