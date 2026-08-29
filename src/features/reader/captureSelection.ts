import type { HighlightRect, SelectionCapture } from "../../core/models/favorite";
import { normalizeText } from "../../pdf/TextLocator/normalizeText";

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function captureSelection(
  textLayer: HTMLDivElement,
  documentId: string,
  pageNumber: number,
  pageText: string,
): SelectionCapture | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)) {
    return null;
  }
  const selectedText = selection.toString().trim();
  const normalizedText = normalizeText(selectedText);
  if (!normalizedText) return null;

  const layerRect = textLayer.getBoundingClientRect();
  if (layerRect.width <= 0 || layerRect.height <= 0) return null;
  const rects: HighlightRect[] = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: clamp((rect.left - layerRect.left) / layerRect.width),
      y: clamp((rect.top - layerRect.top) / layerRect.height),
      width: clamp(rect.width / layerRect.width),
      height: clamp(rect.height / layerRect.height),
    }));
  if (!rects.length) return null;

  const normalizedPage = normalizeText(pageText || textLayer.textContent || "");
  const occurrences: number[] = [];
  let occurrence = normalizedPage.indexOf(normalizedText);
  while (occurrence >= 0) {
    occurrences.push(occurrence);
    occurrence = normalizedPage.indexOf(normalizedText, occurrence + Math.max(1, normalizedText.length));
  }
  let approximateStart = 0;
  try {
    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(textLayer);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    approximateStart = normalizeText(prefixRange.toString()).length;
  } catch {
    approximateStart = 0;
  }
  const textStartIndex = occurrences.length
    ? occurrences.reduce((best, value) => Math.abs(value - approximateStart) < Math.abs(best - approximateStart) ? value : best)
    : -1;
  const textEndIndex = textStartIndex >= 0 ? textStartIndex + normalizedText.length : null;
  const contextRadius = 200;
  const contextBefore =
    textStartIndex >= 0
      ? normalizedPage.slice(Math.max(0, textStartIndex - contextRadius), textStartIndex)
      : "";
  const contextAfter =
    textEndIndex !== null
      ? normalizedPage.slice(textEndIndex, Math.min(normalizedPage.length, textEndIndex + contextRadius))
      : "";
  const bounds = range.getBoundingClientRect();

  return {
    documentId,
    selectedText,
    normalizedText,
    pageNumber,
    textStartIndex: textStartIndex >= 0 ? textStartIndex : null,
    textEndIndex,
    contextBefore,
    contextAfter,
    selectionRectsJson: JSON.stringify(rects),
    rects,
    bounds: {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
