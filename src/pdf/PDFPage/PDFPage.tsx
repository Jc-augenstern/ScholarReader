import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ZoomMode } from "../../core/models/document";
import type { ElementSize } from "../../hooks/useElementSize";
import {
  renderPdfPage,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "../adapter/pdfJsAdapter";
import type { Favorite, SelectionCapture } from "../../core/models/favorite";
import { captureSelection } from "../../features/reader/captureSelection";
import {
  resolveTextLayerCaretAtPoint,
  setSelectionBaseAndExtent,
  snapSelectionToEnglishWordBoundaries,
  type TextCaret,
} from "../../features/reader/selectionAcquisition";
import {
  calculateHighlightRects,
  locateFavorite,
  type TextLocationResult,
} from "../TextLocator/TextLocator";
import { HighlightLayer, type ResolvedHighlight } from "../HighlightLayer/HighlightLayer";

type PDFPageProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  rotation: number;
  searchQuery: string;
  viewportSize: ElementSize;
  zoomMode: ZoomMode;
  zoomValue: number;
  onScaleResolved?: (scale: number) => void;
  documentId: string;
  onSelection?: (selection: SelectionCapture | null) => void;
  favorites?: Favorite[];
  highlightMode?: "none" | "target" | "all";
  targetFavoriteId?: string | null;
  currentDocumentHash: string;
  onFavoriteClick?: (favorite: Favorite) => void;
  onLocateResult?: (result: TextLocationResult) => void;
};

function resolveScale(
  page: PDFPageProxy,
  mode: ZoomMode,
  value: number,
  viewportSize: ElementSize,
): number {
  if (mode === "custom") return value;
  const base = page.getViewport({ scale: 1 });
  const widthScale = Math.max(0.2, (viewportSize.width - 96) / base.width);
  if (mode === "fit-width") return Math.min(widthScale, 4);
  const heightScale = Math.max(0.2, (viewportSize.height - 72) / base.height);
  return Math.min(widthScale, heightScale, 4);
}

export function PDFPage({
  pdf,
  pageNumber,
  rotation,
  searchQuery,
  viewportSize,
  zoomMode,
  zoomValue,
  onScaleResolved,
  documentId,
  onSelection,
  favorites = [],
  highlightMode = "all",
  targetFavoriteId,
  currentDocumentHash,
  onFavoriteClick,
  onLocateResult,
}: PDFPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [pageText, setPageText] = useState("");
  const [highlights, setHighlights] = useState<ResolvedHighlight[]>([]);
  const pointerGestureRef = useRef<{
    pointerId: number;
    anchor: TextCaret | null;
    startedInTextLayer: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    setRendering(true);
    setError(null);
    void pdf
      .getPage(pageNumber)
      .then((nextPage) => {
        if (active) setPage(nextPage);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      setPage(null);
    };
  }, [pageNumber, pdf]);

  const scale = useMemo(
    () => (page ? resolveScale(page, zoomMode, zoomValue, viewportSize) : zoomValue),
    [page, viewportSize, zoomMode, zoomValue],
  );

  useEffect(() => {
    if (!page || !canvasRef.current || !textLayerRef.current || viewportSize.width === 0) return;
    let active = true;
    setRendering(true);
    const task = renderPdfPage({
      page,
      canvas: canvasRef.current,
      textLayer: textLayerRef.current,
      scale,
      rotation,
    });
    void task.promise
      .then((text) => {
        if (active) {
          setPageText(text);
          setRendering(false);
          onScaleResolved?.(scale);
        }
      })
      .catch((reason: unknown) => {
        if (active && !(reason instanceof Error && reason.name === "RenderingCancelledException")) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setRendering(false);
        }
      });
    return () => {
      active = false;
      task.cancel();
    };
  }, [onScaleResolved, page, rotation, scale, viewportSize.width]);

  useEffect(() => {
    const container = textLayerRef.current;
    if (!container || rendering) return;
    const needle = searchQuery.trim().toLocaleLowerCase();
    container.querySelectorAll("span").forEach((span) => {
      const hit = needle.length >= 2 && (span.textContent ?? "").toLocaleLowerCase().includes(needle);
      span.classList.toggle("reader-search-hit", hit);
    });
  }, [rendering, searchQuery]);

  useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer || rendering || !pageText || highlightMode === "none") {
      setHighlights([]);
      return;
    }
    const resolved: ResolvedHighlight[] = [];
    favorites
      .filter((favorite) => favorite.pageNumber === pageNumber)
      .filter((favorite) => highlightMode === "all" || favorite.id === targetFavoriteId)
      .forEach((favorite) => {
        const location = locateFavorite(pageText, favorite, currentDocumentHash);
        const isTarget = favorite.id === targetFavoriteId;
        let rects = location.rects;
        if (
          !rects.length &&
          location.confidence >= 0.78 &&
          location.startIndex !== null &&
          location.endIndex !== null
        ) {
          rects = calculateHighlightRects(layer, location.startIndex, location.endIndex);
        }
        if (rects.length && location.confidence >= 0.78) {
          resolved.push({ favorite, rects, isTarget });
        }
        if (isTarget) onLocateResult?.(location);
      });
    setHighlights(resolved);
  }, [
    currentDocumentHash,
    favorites,
    highlightMode,
    onLocateResult,
    pageNumber,
    pageText,
    rendering,
    targetFavoriteId,
  ]);

  const finishSelection = useCallback(() => {
    window.setTimeout(() => {
      const layer = textLayerRef.current;
      if (!layer) {
        onSelection?.(null);
        return;
      }
      snapSelectionToEnglishWordBoundaries(layer);
      onSelection?.(captureSelection(layer, documentId, pageNumber, pageText));
    }, 0);
  }, [documentId, onSelection, pageNumber, pageText]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const layer = textLayerRef.current;
    if (!layer) return;
    const caret = resolveTextLayerCaretAtPoint(layer, event.clientX, event.clientY);
    const startedInTextLayer = layer.contains(event.target as Node) || Boolean(caret);
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      anchor: caret?.assisted ? caret : null,
      startedInTextLayer,
    };
    if (!caret) {
      if (event.target === layer || event.target === canvasRef.current) {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
      }
      return;
    }
    if (!caret.assisted) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSelectionBaseAndExtent(caret, caret);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    const layer = textLayerRef.current;
    if (!gesture?.anchor || gesture.pointerId !== event.pointerId || !layer || !(event.buttons & 1)) return;
    const focus = resolveTextLayerCaretAtPoint(layer, event.clientX, event.clientY);
    if (!focus) return;
    event.preventDefault();
    setSelectionBaseAndExtent(gesture.anchor, focus);
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    const layer = textLayerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !layer) return;
    const focus = resolveTextLayerCaretAtPoint(layer, event.clientX, event.clientY);
    if (gesture.anchor && focus) {
      event.preventDefault();
      setSelectionBaseAndExtent(gesture.anchor, focus);
    } else if (gesture.startedInTextLayer && focus?.assisted) {
      const selection = window.getSelection();
      if (
        selection?.anchorNode?.nodeType === Node.TEXT_NODE &&
        layer.contains(selection.anchorNode)
      ) {
        setSelectionBaseAndExtent(
          {
            node: selection.anchorNode as Text,
            offset: selection.anchorOffset,
            assisted: false,
            distance: 0,
          },
          focus,
        );
      }
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerGestureRef.current = null;
  }, []);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerGestureRef.current?.pointerId === event.pointerId) pointerGestureRef.current = null;
  }, []);

  return (
    <div
      className="pdf-page-stage"
      aria-busy={rendering}
      aria-label={`PDF 第 ${pageNumber} 页`}
      onMouseUp={finishSelection}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <canvas ref={canvasRef} />
      <HighlightLayer highlights={highlights} onFavoriteClick={onFavoriteClick} />
      <div className="textLayer" data-page-number={pageNumber} ref={textLayerRef} />
      {rendering && !error ? <div className="page-rendering"><span className="spinner dark" />正在渲染第 {pageNumber} 页</div> : null}
      {error ? <div className="page-render-error">此页渲染失败：{error}</div> : null}
    </div>
  );
}
