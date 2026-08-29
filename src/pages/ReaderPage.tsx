import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Highlighter,
  Minus,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Document, ZoomMode } from "../core/models/document";
import { usePdfSearch } from "../features/reader/usePdfSearch";
import { useElementSize } from "../hooks/useElementSize";
import { loadPdfDocument, type PDFDocumentProxy } from "../pdf/adapter/pdfJsAdapter";
import { PDFPage } from "../pdf/PDFPage/PDFPage";
import { documentGateway } from "../platform/tauri/documentGateway";
import { readerGateway } from "../platform/tauri/readerGateway";
import { useLibraryStore } from "../stores/libraryStore";
import "pdfjs-dist/web/pdf_viewer.css";
import type { Favorite, SelectionCapture } from "../core/models/favorite";
import type { TextLocationResult } from "../pdf/TextLocator/TextLocator";
import {
  SelectionToolbar,
  type SelectionAction,
} from "../pdf/SelectionToolbar/SelectionToolbar";
import { favoriteGateway } from "../platform/tauri/favoriteGateway";
import { useAiStore } from "../stores/aiStore";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;

function readableError(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return error instanceof Error ? error.message : String(error);
}

export function ReaderPage() {
  const { documentId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const targetFavoriteId = searchParams.get("favorite");
  const requestedPage = Number(searchParams.get("page"));
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const refreshLibrary = useLibraryStore((state) => state.loadDocuments);
  const [document, setDocument] = useState<Document | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageOffsetRatio, setPageOffsetRatio] = useState(0);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit-width");
  const [zoomValue, setZoomValue] = useState(1);
  const [resolvedScale, setResolvedScale] = useState(1);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [restored, setRestored] = useState(false);
  const [selection, setSelection] = useState<SelectionCapture | null>(null);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const runAi = useAiStore((state) => state.run);
  const [documentFavorites, setDocumentFavorites] = useState<Favorite[]>([]);
  const [highlightMode, setHighlightMode] = useState<"none" | "target" | "all">("all");
  const [activeFavorite, setActiveFavorite] = useState<Favorite | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [rebinding, setRebinding] = useState(false);
  const locatedTargetRef = useRef<string | null>(null);
  const viewportSize = useElementSize(viewportRef, !loading && Boolean(pdf));
  const { results, searching, pagesScanned } = usePdfSearch(pdf, searchQuery);

  const goToPage = useCallback(
    (nextPage: number) => {
      const pageCount = pdf?.numPages ?? document?.pageCount ?? 1;
      const clamped = Math.min(Math.max(Math.round(nextPage), 1), pageCount);
      setPageNumber(clamped);
      setPageInput(String(clamped));
      setPageOffsetRatio(0);
      viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
    [document?.pageCount, pdf?.numPages],
  );

  const zoomBy = useCallback((delta: number) => {
    setZoomMode("custom");
    setZoomValue((value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + delta)));
  }, []);

  const handleSelectionAction = useCallback(
    (action: SelectionAction) => {
      if (!selection) return;
      if (action === "favorite") {
        const duplicate = documentFavorites.find(
          (favorite) =>
            favorite.pageNumber === selection.pageNumber &&
            favorite.normalizedText === selection.normalizedText,
        );
        if (duplicate && !window.confirm("这段内容似乎已经收藏。仍然收藏一份新记录吗？")) {
          setSelection(null);
          window.getSelection()?.removeAllRanges();
          return;
        }
        setSavingFavorite(true);
        void favoriteGateway
          .create(selection)
          .then((favorite) => {
            setDocumentFavorites((items) => [favorite, ...items]);
            setSelectionNotice("★ 已加入收藏");
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          })
          .catch((reason: unknown) => setSelectionNotice(`收藏失败：${readableError(reason)}`))
          .finally(() => setSavingFavorite(false));
        return;
      }
      void runAi(action, selection);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    },
    [documentFavorites, runAi, selection],
  );

  const handleLocateResult = useCallback(
    (result: TextLocationResult) => {
      if (!targetFavoriteId || locatedTargetRef.current === targetFavoriteId) return;
      locatedTargetRef.current = targetFavoriteId;
      if (result.success && result.confidence >= 0.78) {
        setSelectionNotice(`已回到原文 · ${result.matchType} · ${Math.round(result.confidence * 100)}%`);
      } else {
        setSelectionNotice("已打开收藏所在页面，但无法准确定位原文。");
      }
    },
    [targetFavoriteId],
  );

  useEffect(() => {
    let active = true;
    let loadingTask: ReturnType<typeof loadPdfDocument> | null = null;
    setLoading(true);
    setError(null);
    setRestored(false);
    void (async () => {
      const nextDocument = await documentGateway.get(documentId);
      if (active) setDocument(nextDocument);
      const [progress, bytes, favorites] = await Promise.all([
        readerGateway.getProgress(documentId),
        readerGateway.readBytes(documentId),
        favoriteGateway.list(undefined, documentId),
      ]);
      const refreshedDocument = await documentGateway.get(documentId);
      if (active) setDocument(refreshedDocument);
      loadingTask = loadPdfDocument(bytes);
      const loadedPdf = await loadingTask.promise;
      if (!active) {
        await loadingTask.destroy();
        return;
      }
      setPdf(loadedPdf);
      setDocumentFavorites(favorites);
      const initialPage = Number.isFinite(requestedPage) && requestedPage > 0
        ? requestedPage
        : progress?.pageNumber ?? 1;
      const safePage = Math.min(Math.max(initialPage, 1), loadedPdf.numPages);
      setPageNumber(safePage);
      setPageInput(String(safePage));
      if (progress) {
        setPageOffsetRatio(progress.pageOffsetRatio);
        setZoomMode(progress.zoomMode);
        setZoomValue(progress.zoomValue);
        setRotation(progress.rotation);
      }
      if (refreshedDocument.pageCount !== loadedPdf.numPages) {
        setDocument(await documentGateway.setPageCount(documentId, loadedPdf.numPages));
        void refreshLibrary();
      }
      setRestored(true);
      setLoading(false);
    })().catch((reason: unknown) => {
      if (active) {
        setError(readableError(reason));
        setLoading(false);
      }
    });

    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [documentId, refreshLibrary, requestedPage, retryToken]);

  useEffect(() => {
    if (!restored || !pdf) return;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void readerGateway
        .saveProgress({
          documentId,
          pageNumber,
          pageOffsetRatio,
          zoomMode,
          zoomValue,
          rotation,
        })
        .then(() => {
          setSaveState("saved");
          void refreshLibrary();
        })
        .catch(() => setSaveState("error"));
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [documentId, pageNumber, pageOffsetRatio, pdf, refreshLibrary, restored, rotation, zoomMode, zoomValue]);

  useEffect(() => {
    if (!restored || !viewportRef.current) return;
    const timeout = window.setTimeout(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = pageOffsetRatio * Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pageNumber, resolvedScale, restored]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.ctrlKey && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.ctrlKey && event.key === "-") {
        event.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (event.ctrlKey && event.key === "0") {
        event.preventDefault();
        setZoomMode("fit-width");
      } else if (event.key === "PageDown") {
        goToPage(pageNumber + 1);
      } else if (event.key === "PageUp") {
        goToPage(pageNumber - 1);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setSelection(null);
      } else if (event.ctrlKey && event.key.toLocaleLowerCase() === "b" && selection) {
        event.preventDefault();
        handleSelectionAction("favorite");
      } else if (event.altKey && selection) {
        const action = { e: "explain", t: "translate", s: "summarize" }[
          event.key.toLocaleLowerCase()
        ] as SelectionAction | undefined;
        if (action) {
          event.preventDefault();
          handleSelectionAction(action);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPage, handleSelectionAction, pageNumber, selection, zoomBy]);

  useEffect(() => {
    const onFavoriteCreated = (event: Event) => {
      const favorite = (event as CustomEvent<Favorite>).detail;
      if (favorite?.documentId === documentId) {
        setDocumentFavorites((items) => items.some((item) => item.id === favorite.id) ? items : [favorite, ...items]);
        setSelectionNotice("★ 已加入收藏");
      }
    };
    window.addEventListener("scholar:favorite-created", onFavoriteCreated);
    return () => window.removeEventListener("scholar:favorite-created", onFavoriteCreated);
  }, [documentId]);

  useEffect(() => {
    if (!searchOpen) return;
    const timeout = window.setTimeout(() => {
      window.document.querySelector<HTMLInputElement>(".reader-search input")?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchOpen]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const timeout = window.setTimeout(() => setSaveState("idle"), 1500);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  useEffect(() => {
    if (!selectionNotice) return;
    const timeout = window.setTimeout(() => setSelectionNotice(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [selectionNotice]);

  const submitPage = () => {
    const value = Number(pageInput);
    if (Number.isFinite(value)) goToPage(value);
    else setPageInput(String(pageNumber));
  };

  if (loading) {
    return <div className="reader-loading"><span className="spinner dark" />正在打开 PDF 并恢复阅读位置…</div>;
  }

  if (error || !pdf || !document) {
    return (
      <div className="reader-error-page">
        <h1>无法打开 PDF</h1>
        <p>{error ?? "文档不存在或无法解析。"}</p>
        <div className="reader-error-actions">
          <Link className="secondary-button" to="/library"><ArrowLeft size={16} />返回文件库</Link>
          {document ? (
            <button
              className="primary-button"
              disabled={rebinding}
              onClick={() => {
                setRebinding(true);
                void documentGateway.pickSinglePdfPath().then(async (path) => {
                  if (!path) return;
                  const candidate = await documentGateway.checkRebind(document.id, path);
                  const allowChanged = candidate.hashMatches || window.confirm(
                    `所选 PDF 与原文件 Hash 不同。文件名匹配：${candidate.filenameMatches ? "是" : "否"}；大小匹配：${candidate.sizeMatches ? "是" : "否"}。仍要重新绑定吗？`,
                  );
                  if (!allowChanged) return;
                  await documentGateway.rebind(document.id, path, !candidate.hashMatches);
                  setRetryToken((value) => value + 1);
                }).catch((reason) => setError(`重新定位失败：${readableError(reason)}`)).finally(() => setRebinding(false));
              }}
              type="button"
            >{rebinding ? "正在校验…" : "重新定位文件"}</button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="reader-page">
      <div className="reader-toolbar" role="toolbar" aria-label="PDF 阅读工具">
        <Link className="reader-back" to="/library" title="返回文件库"><ArrowLeft size={17} /></Link>
        <div className="reader-document-title" title={document.filepath}>
          <strong>{document.title}</strong>
          <span>{document.filename}</span>
        </div>
        <div className="toolbar-divider" />
        <button aria-label="上一页" className="toolbar-button" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)} type="button"><ChevronLeft size={17} /></button>
        <label className="page-number-control">
          <input
            aria-label="当前页码"
            inputMode="numeric"
            onBlur={submitPage}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submitPage()}
            ref={pageInputRef}
            value={pageInput}
          />
          <span>/ {pdf.numPages}</span>
        </label>
        <button aria-label="下一页" className="toolbar-button" disabled={pageNumber >= pdf.numPages} onClick={() => goToPage(pageNumber + 1)} type="button"><ChevronRight size={17} /></button>
        <div className="toolbar-divider" />
        <button aria-label="缩小" className="toolbar-button" onClick={() => zoomBy(-ZOOM_STEP)} type="button"><Minus size={16} /></button>
        <button className="zoom-readout" onClick={() => setZoomMode("fit-width")} title="点击恢复适合宽度" type="button">{Math.round(resolvedScale * 100)}%</button>
        <button aria-label="放大" className="toolbar-button" onClick={() => zoomBy(ZOOM_STEP)} type="button"><Plus size={16} /></button>
        <button className={`toolbar-button${zoomMode === "fit-page" ? " active" : ""}`} onClick={() => setZoomMode("fit-page")} title="适合页面" type="button"><Maximize2 size={16} /></button>
        <button aria-label="旋转页面" className="toolbar-button" onClick={() => setRotation((value) => ((value + 90) % 360) as 0 | 90 | 180 | 270)} type="button"><RotateCw size={16} /></button>
        <button
          aria-label="切换收藏高亮"
          className={`toolbar-button${highlightMode !== "none" ? " active" : ""}`}
          onClick={() => setHighlightMode((mode) => mode === "all" ? "target" : mode === "target" ? "none" : "all")}
          title={`收藏高亮：${highlightMode === "all" ? "本文档全部" : highlightMode === "target" ? "只显示当前定位" : "不显示"}`}
          type="button"
        ><Highlighter size={16} /></button>
        <div className="toolbar-spacer" />
        <span className={`save-indicator ${saveState}`}>{saveState === "saving" ? "保存中…" : saveState === "saved" ? "进度已保存" : saveState === "error" ? "进度保存失败" : ""}</span>
        <button className={`toolbar-button${searchOpen ? " active" : ""}`} onClick={() => setSearchOpen((value) => !value)} title="文档内搜索 (Ctrl+F)" type="button"><Search size={17} /></button>
      </div>

      {searchOpen ? (
        <aside className="reader-search" aria-label="文档内搜索">
          <div className="reader-search-header">
            <label><Search size={15} /><input aria-label="搜索当前 PDF" onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索当前 PDF" value={searchQuery} /></label>
            <button aria-label="关闭搜索" className="icon-button" onClick={() => setSearchOpen(false)} type="button"><X size={16} /></button>
          </div>
          <div className="search-progress">
            {searchQuery.trim().length < 2
              ? "输入至少 2 个字符"
              : searching
                ? `正在搜索 ${pagesScanned} / ${pdf.numPages} 页`
                : `找到 ${results.reduce((sum, item) => sum + item.occurrences, 0)} 处结果`}
          </div>
          <div className="search-results">
            {results.map((result) => (
              <button key={result.pageNumber} onClick={() => goToPage(result.pageNumber)} type="button">
                <strong>第 {result.pageNumber} 页 <span>{result.occurrences} 处</span></strong>
                <p>{result.snippet}</p>
              </button>
            ))}
            {!searching && searchQuery.trim().length >= 2 && !results.length ? <p className="search-empty">没有找到匹配文本。</p> : null}
          </div>
        </aside>
      ) : null}

      {selection ? (
        <SelectionToolbar
          onAction={handleSelectionAction}
          saving={savingFavorite}
          selection={selection}
        />
      ) : null}
      {selectionNotice ? <div className="reader-toast">{selectionNotice}</div> : null}
      {activeFavorite ? (
        <aside className="highlight-popover">
          <button aria-label="关闭收藏信息" onClick={() => setActiveFavorite(null)} type="button"><X size={14} /></button>
          <span>收藏于 {new Date(activeFavorite.createdAt).toLocaleDateString("zh-CN")}</span>
          <blockquote>“{activeFavorite.selectedText}”</blockquote>
          {activeFavorite.tags.length ? <div>{activeFavorite.tags.map((tag) => <em key={tag.id}>#{tag.name}</em>)}</div> : null}
          <label className="highlight-note-field">备注
            <textarea
              onBlur={() => {
                void favoriteGateway.update({
                  id: activeFavorite.id,
                  note: activeFavorite.note,
                  tagNames: activeFavorite.tags.map((tag) => tag.name),
                }).then((updated) => {
                  setActiveFavorite(updated);
                  setDocumentFavorites((items) => items.map((item) => item.id === updated.id ? updated : item));
                });
              }}
              onChange={(event) => setActiveFavorite({ ...activeFavorite, note: event.target.value })}
              placeholder="添加学习备注…"
              rows={2}
              value={activeFavorite.note}
            />
          </label>
          <footer>
            <Link to="/favorites">查看收藏</Link>
            <button onClick={() => {
              if (!window.confirm("取消这条收藏？")) return;
              void favoriteGateway.remove(activeFavorite.id).then(() => {
                setDocumentFavorites((items) => items.filter((item) => item.id !== activeFavorite.id));
                setActiveFavorite(null);
              });
            }} type="button">取消收藏</button>
          </footer>
        </aside>
      ) : null}

      <div
        className="reader-viewport"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const scrollable = viewport.scrollHeight - viewport.clientHeight;
          setPageOffsetRatio(scrollable > 0 ? viewport.scrollTop / scrollable : 0);
        }}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        }}
        ref={viewportRef}
      >
        <PDFPage
          documentId={documentId}
          currentDocumentHash={document.fileHash}
          favorites={documentFavorites}
          highlightMode={highlightMode}
          onScaleResolved={setResolvedScale}
          onFavoriteClick={setActiveFavorite}
          onLocateResult={handleLocateResult}
          onSelection={(nextSelection) => {
            if (nextSelection) setSelection(nextSelection);
          }}
          pageNumber={pageNumber}
          pdf={pdf}
          rotation={rotation}
          searchQuery={searchQuery}
          targetFavoriteId={targetFavoriteId}
          viewportSize={viewportSize}
          zoomMode={zoomMode}
          zoomValue={zoomValue}
        />
      </div>
      <div className="reader-footer">第 {pageNumber} 页，共 {pdf.numPages} 页 · Canvas Layer + Text Layer</div>
    </div>
  );
}
