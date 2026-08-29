import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const runtime = {
  filename: "llama-runtime-b10603.zip",
  size: 18_063_576,
  sha256: "878efa5bc0cdeb9c3fcb96335521556e06ca9252f83de3a1d924981918607702",
  sources: [
    "https://gh-proxy.com/https://github.com/ggml-org/llama.cpp/releases/download/b10603/llama-b10603-bin-win-cpu-x64.zip",
    "https://github.com/ggml-org/llama.cpp/releases/download/b10603/llama-b10603-bin-win-cpu-x64.zip",
  ],
};

const destination = resolve("src-tauri", "generated-resources", "managed-ai", runtime.filename);
const temporary = `${destination}.part`;

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function isValid(path) {
  try {
    return (await stat(path)).size === runtime.size && await digest(path) === runtime.sha256;
  } catch {
    return false;
  }
}

if (await isValid(destination)) {
  console.log(`Managed AI runtime already verified: ${destination}`);
  process.exit(0);
}

await mkdir(dirname(destination), { recursive: true });
await rm(temporary, { force: true });

let lastError;
for (const source of runtime.sources) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    console.log(`Downloading verified llama.cpp runtime from ${new URL(source).host}...`);
    const response = await fetch(source, { redirect: "follow", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const actual = await digest(temporary);
    const size = (await stat(temporary)).size;
    if (size !== runtime.size || actual !== runtime.sha256) {
      throw new Error(`integrity mismatch (size ${size}, sha256 ${actual})`);
    }
    await rename(temporary, destination);
    console.log(`Managed AI runtime verified: ${destination}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    await rm(temporary, { force: true });
    console.warn(`Runtime source failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

throw new Error(`Could not prepare the Managed AI runtime: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
