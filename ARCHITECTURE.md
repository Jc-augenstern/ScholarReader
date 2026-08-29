# ScholarReader Architecture

> Status: accepted and in implementation. This document records the stable boundaries for the first formal release. Core reading and study workflows must remain fully usable without AI, network access, or an API key.

## 1. 需求分析

ScholarReader is a Windows-first, local-first desktop PDF study reader for papers, textbooks, and lecture notes. Its highest-priority workflow is: open a PDF, select important text, save it offline, find it weeks later, and return to the exact source location with a non-destructive highlight.

The product has two deliberately separate capability sets:

- Core: document library, PDF reading, text selection/search/copy, reading progress, favorites, tags, notes, source recovery, locator, highlights, Explorer/Finder integration.
- AI enhancement: explain, translate, summarize. AI failures may only fail the current AI request.

The first release excludes OCR, PDF editing/write-back, accounts, sync, RAG, paper chat, knowledge graphs, and collaborative features.

Confirmed decisions:

1. A v1 favorite is a single-page selection. Cross-page selections are rejected with a clear prompt to save each page separately.
2. Rust exclusively owns SQLite, filesystem access, platform operations, and AI credentials/requests. React never receives an unrestricted filesystem capability or a stored API key.
3. Locator confidence thresholds are fixed initially: exact+context `1.0`, unique exact `0.95`, context `0.85`, fuzzy candidate `0.65`; automatic highlighting requires at least `0.78`, otherwise the reader falls back to page-only.
4. v1 library/favorite search uses normalized parameterized `LIKE` queries and in-memory current-PDF search. FTS5 is deferred until measured data volume justifies it.

## 2. 推荐技术架构

- Desktop shell: Tauri 2.
- Frontend: React, TypeScript, Vite, React Router, Zustand.
- PDF engine: PDF.js with a dedicated module worker.
- Persistence: SQLite through Rust `sqlx`, WAL mode, foreign keys, migrations from process start.
- Backend: async Rust commands returning typed serializable DTOs and structured errors.
- AI: Rust-side providers for ScholarReader-managed local inference, OpenAI-compatible, Ollama, and custom-compatible services. Provider configuration remains a stable JSON setting and cloud credentials remain in the OS credential store.
- Tests: Vitest/Testing Library for frontend logic, Rust unit/integration tests for repositories and commands, real-PDF smoke fixtures for PDF.js behavior.

The frontend is an application client, not the security boundary. Every document read and mutation is resolved from a database identity in Rust.

## 3. 项目目录结构

```text
src/
  app/                    routing and shell
  components/             shared presentation components
  core/models/            domain DTOs and stable types
  features/
    reader/                reading/search/selection orchestration
    favorites/             favorite UI and state
    highlights/            highlight projection and interaction
    ai/                    optional AI UI, onboarding, and service coordination
  hooks/                   reusable React hooks
  pages/                   route pages
  pdf/
    adapter/               only module importing PDF.js APIs
    PDFPage/               Canvas + Text + Highlight composition
    SelectionToolbar/      selection interaction
    TextLocator/           pure locator algorithms
  platform/tauri/          typed invoke gateways
  stores/                  Zustand application stores
  utils/                   pure helpers

src-tauri/
  migrations/             append-only SQL migrations
  src/
    commands/              thin Tauri command boundary
    database.rs            pool and migration bootstrap
    models.rs              DTOs
    platform/              file/reveal/credential adapters
    ai/                    provider, model download, and local runtime lifecycle
```

PDF.js must only be imported by the PDF adapter/reader chunks so the library/home bundle stays small.

## 4. SQLite Schema

The schema evolves only through numbered migrations.

- `documents`: identity, display title, filename/path/path key, SHA-256, size, source mtime, page count, file favorite flag, timestamps.
- `reading_progress`: one row per document with page, normalized page offset, zoom mode/value, rotation, timestamp.
- `favorites`: document foreign key, raw and normalized selection, page, text indexes, context, normalized rect JSON, note, locator/hash metadata, timestamps.
- `tags`: unique normalized name and display name.
- `favorite_tags`: favorite/tag composite primary key with cascades.
- `settings`: JSON values by stable key.

Foreign keys are enabled, user-owned source PDF files are never deleted by a library-record deletion, and favorite rows cascade only when the user explicitly removes the document record from the library.

## 5. 页面结构

The persistent desktop shell uses top toolbar, left navigation, primary center content, right inspector, and status bar. Routes are:

- `/`: continue reading, recent documents, recent favorites.
- `/library`: searchable document library and import actions.
- `/reader/:documentId`: PDF reader with a route-level lazy PDF.js chunk.
- `/favorites`: searchable favorite cards, tags, notes, source actions.
- `/recent`, `/tags`, `/settings`: focused supporting pages.

The reader keeps the center region dominant. The right panel becomes contextual for selection/AI/favorite details.

## 6. 核心组件

- `documentGateway` / Rust document repository: import, dedupe, rename, star, remove record, rebind.
- `readerGateway`: validated PDF bytes and reading progress.
- `PDFPage`: Canvas Layer, Text Layer, Highlight Layer.
- `SelectionToolbar`: near-selection actions and boundary handling.
- favorite repository/store: immediate offline save, update, delete, query by current document/page.
- `TextLocator`: pure normalization and multi-level matching.
- platform service: open internally, open externally, reveal in file manager, copy path, and rebind.
- AI provider service: isolated optional requests with cancellation and connection tests.
- `AIOnboarding`: first-use, non-technical opt-in flow with real assessment/download status.
- `AIServiceManager`: selects and activates providers without allowing AI work to block Core.
- `ModelManager`: resumable model download, SHA-256 verification, license receipt, and removal.
- `LocalRuntimeManager`: installs the verified runtime resource, binds only to loopback, performs real completions, restarts once after failure, and stops after ten idle minutes.
- `ManagedLocalProvider`: explain/translate/summarize adapter over the managed runtime.

## 7. Core 与 AI 层边界

Core never imports AI code, reads AI settings, or waits for an AI request. The selection toolbar emits either a core `saveFavorite` action or an AI action. AI output is never substituted for `selected_text`; “收藏原文” always saves the original selection.

Rust stores AI keys in OS credential storage where available. Provider failures return AI-scoped errors and cannot roll back or block document, favorite, or progress writes.

### 7.1 Managed Local AI decision

The managed provider uses the CPU Windows x64 build of `llama.cpp` (`llama-server`, build `b10603`, commit `c060ca974`) as an isolated child process. The exact runtime archive is fetched during the release build, checked against a pinned byte size and SHA-256, then bundled as a Tauri resource. It is installed into the OS-provided application-local-data directory on first opt-in and listens on a random `127.0.0.1` port protected by a generated per-install API key. `llama.cpp` is MIT licensed; the upstream license and retained LLVM OpenMP notice are shipped in the installer. Authoritative sources: [llama.cpp license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE) and [upstream releases](https://github.com/ggml-org/llama.cpp/releases/).

The default model is the official Qwen3 1.7B GGUF `Q8_0` artifact; devices with less than 8 GiB RAM use the official Qwen3 0.6B GGUF `Q8_0` artifact. Both have pinned immutable revision URLs, exact sizes, and SHA-256 values in `src-tauri/src/ai/manifest.rs`. Qwen publishes both repositories under Apache-2.0, with Chinese/English and broader multilingual support suitable for short translation, explanation, and summarization. The model is downloaded only after user opt-in, its checksum and license are verified, and it is kept outside SQLite and the source tree. Authoritative sources: [Qwen3 1.7B GGUF](https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF) and [Qwen3 0.6B GGUF](https://modelscope.cn/models/Qwen/Qwen3-0.6B-GGUF).

The application-data boundary is:

```text
app-local-data/
  scholar-reader.db        Core data and JSON settings
  managed-ai/
    models/                verified GGUF and license/receipt
    runtime/               verified extracted llama.cpp runtime
    downloads/             resumable partial model download
    logs/                  local runtime diagnostic log
```

Deleting a local model is a separately confirmed operation and cannot delete the database, source PDFs, favorites, tags, notes, or reading progress. No database migration is required for this addition because `settings` already stores versioned JSON and the old `openai`, `ollama`, and `custom` values remain valid. An upgraded installation therefore keeps its selected Provider and Windows Credential Manager secret unchanged.

`ScholarCloudProvider` is reserved as a future provider boundary only. No cloud service is represented as implemented, and no developer API credential may be embedded in Rust, JavaScript, the executable, or the repository.

## 8. PDF.js Text Layer 方案

Each mounted page is composed as:

```text
PDFPage (position: relative)
  Canvas Layer             pixels only
  Text Layer               PDF.js spans, selection/copy/search
  Highlight Overlay Layer  pointer-aware normalized rectangles
```

The worker is loaded as a dedicated static module asset. A page render task exposes cancellation immediately so React navigation/unmount never leaves two tasks using one canvas. Large PDFs mount only the current/nearby page set; search extracts text asynchronously and yields between pages.

Selection is accepted only when the DOM `Range` starts and ends inside the same `.textLayer[data-page-number]`. `Range.getClientRects()` is intersected with the page bounds and normalized to ratios so zoom changes do not invalidate stored geometry.

## 9. 收藏定位方案

Saving a favorite captures:

- raw selected text and normalized text;
- one-based page number;
- page-text start/end indexes when resolvable;
- about 200 normalized characters before and after;
- selection rectangles normalized against the page viewport;
- current document hash and locator version.

Locating uses progressively weaker evidence:

1. Stored indexes/rects when the document hash and local text slice still agree.
2. Unique exact normalized-text match.
3. Exact match ranked by before/after context.
4. Fuzzy token/edit-distance match around candidates.
5. Page-only fallback with an honest warning.

AI is never used for locating.

## 10. Highlight Layer 方案

Highlights are absolutely positioned percentage rectangles above the canvas and below/alongside the Text Layer. They never modify the PDF. Favorites are queried once for the active document, grouped as `Map<pageNumber, Favorite[]>`, and only projected for mounted pages.

Modes are `none`, `target`, and `all` (default `all`). A returned-to-source favorite receives a subtle one-second flash. Clicking a highlight opens metadata actions without stealing normal text selection from unrelated areas.

## 11. TextLocator 设计

`TextLocator` is framework-independent and exposes:

```ts
normalizeText(text)
findExactMatch(pageText, anchor)
findContextMatch(pageText, anchor)
findFuzzyMatch(pageText, anchor)
locateFavorite(pageText, favorite)
calculateHighlightRects(textLayer, match)
```

Normalization applies Unicode NFKC, Unicode-space folding, line-break/whitespace folding, soft-hyphen removal, and conservative end-of-line hyphen joining while maintaining an index map back to original text items. Tests cover duplicate sentences, spacing, line breaks, hyphenation, context ranking, and confidence fallback.

## 12. 文件移动后的恢复方案

When a stored path is absent, Core reports `file_missing` and offers “重新定位文件”. Rust computes candidate filename, size, and SHA-256. A hash match rebinds immediately; a mismatch requires explicit confirmation because saved coordinates become lower priority. Favorites remain attached through `document_id`, so no favorite rows need rewriting.

`revealFileInManager()` is a platform adapter: Explorer `/select,` on Windows and Finder reveal on macOS. Platform commands never appear in React code.

## 13. 开发阶段规划

1. Tauri/React/TypeScript, SQLite migrations/documents, shell/library/import, real window smoke test.
2. PDF.js Canvas/Text Layer reader, paging/zoom/search/progress.
3. Same-page selection toolbar and immediate offline favorite.
4. Favorite library, tags, notes, search, document/platform management.
5. TextLocator, normalized anchors, return-to-source, highlight generation.
6. All-document highlight mode, highlight popover, duplicate detection/edit/delete.
7. Optional AI provider service and explain/translate/summarize UI.
8. themes, shortcuts, performance, error recovery, test matrix.
9. Windows bundles/installers, clean-data migration verification, release artifact validation.

Every phase ends with type checking, tests, a production build, and a running application check before the next phase begins.

## 14. 主要技术风险

- PDF text order can differ from visual order: preserve PDF.js item/index metadata and use context-ranked matching.
- Re-rendered DOM nodes are unstable: store semantic anchors and normalized ratios, never DOM IDs.
- Hyphenation/ligatures/Unicode spaces: maintain tested conservative normalization and original-to-normalized mapping.
- Duplicate phrases: require context and confidence; do not silently choose a low-confidence occurrence.
- Scanned/image-only PDFs: no OCR in v1; communicate that selectable text is unavailable.
- Large documents: lazy page mounting, cancellable renders/search, bounded DPR, document-scoped favorite queries.
- Moved/changed files: verify identity, lower coordinate confidence after hash changes, keep page/text fallback.
- Credential leakage: Rust-only credentials, ignored local configuration, redacted errors/logs.
- SQLite corruption or migration failure: fail startup with a clear recoverable error, do not partially migrate silently.
- WebView/system differences: verify both browser preview rendering and the real Tauri window; package and test on a clean Windows data directory.
