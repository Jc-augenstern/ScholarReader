import type { Favorite, HighlightRect } from "../../core/models/favorite";
import { normalizeText, normalizeTextWithMap } from "./normalizeText";

export type MatchType = "position" | "exact" | "context" | "fuzzy" | "page-only";

export type TextLocationResult = {
  success: boolean;
  pageNumber: number;
  matchType: MatchType;
  rects: HighlightRect[];
  confidence: number;
  startIndex: number | null;
  endIndex: number | null;
};

function parseRects(value: string): HighlightRect[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((rect): rect is HighlightRect => {
      if (!rect || typeof rect !== "object") return false;
      const item = rect as Record<string, unknown>;
      return [item.x, item.y, item.width, item.height].every(
        (number) => typeof number === "number" && Number.isFinite(number),
      );
    });
  } catch {
    return [];
  }
}

function findOccurrences(text: string, needle: string): number[] {
  const positions: number[] = [];
  let offset = text.indexOf(needle);
  while (offset >= 0) {
    positions.push(offset);
    offset = text.indexOf(needle, offset + Math.max(needle.length, 1));
  }
  return positions;
}

function commonSuffixRatio(actual: string, expected: string): number {
  const length = Math.min(actual.length, expected.length);
  let same = 0;
  while (same < length && actual[actual.length - 1 - same] === expected[expected.length - 1 - same]) {
    same += 1;
  }
  return length ? same / length : 0;
}

function commonPrefixRatio(actual: string, expected: string): number {
  const length = Math.min(actual.length, expected.length);
  let same = 0;
  while (same < length && actual[same] === expected[same]) same += 1;
  return length ? same / length : 0;
}

function contextScore(pageText: string, start: number, favorite: Favorite): number {
  const before = normalizeText(favorite.contextBefore).slice(-200);
  const after = normalizeText(favorite.contextAfter).slice(0, 200);
  const actualBefore = pageText
    .slice(Math.max(0, start - before.length - 4), start)
    .trimEnd()
    .slice(-before.length);
  const actualAfter = pageText
    .slice(
      start + normalizeText(favorite.normalizedText).length,
      start + normalizeText(favorite.normalizedText).length + after.length + 4,
    )
    .trimStart()
    .slice(0, after.length);
  const parts = [];
  if (before) parts.push(commonSuffixRatio(actualBefore, before));
  if (after) parts.push(commonPrefixRatio(actualAfter, after));
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : 0;
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.toLocaleLowerCase().split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.toLocaleLowerCase().split(/\s+/).filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

export function locateFavorite(
  rawPageText: string,
  favorite: Favorite,
  currentDocumentHash: string,
): TextLocationResult {
  const pageText = normalizeText(rawPageText);
  const needle = normalizeText(favorite.normalizedText || favorite.selectedText);
  const storedRects = parseRects(favorite.selectionRectsJson);
  const storedStart = favorite.textStartIndex;
  const storedEnd = favorite.textEndIndex;

  if (
    currentDocumentHash === favorite.documentHash &&
    storedStart !== null &&
    storedEnd !== null &&
    pageText.slice(storedStart, storedEnd) === needle &&
    storedRects.length
  ) {
    return { success: true, pageNumber: favorite.pageNumber, matchType: "position", rects: storedRects, confidence: 1, startIndex: storedStart, endIndex: storedEnd };
  }

  const exact = findOccurrences(pageText, needle);
  if (exact.length === 1) {
    return { success: true, pageNumber: favorite.pageNumber, matchType: "exact", rects: [], confidence: 0.95, startIndex: exact[0], endIndex: exact[0] + needle.length };
  }
  if (exact.length > 1) {
    const ranked = exact
      .map((start) => ({ start, score: contextScore(pageText, start, favorite) }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (best.score >= 0.45 && best.score - runnerUp.score >= 0.08) {
      return { success: true, pageNumber: favorite.pageNumber, matchType: "context", rects: [], confidence: Math.min(0.9, 0.72 + best.score * 0.18), startIndex: best.start, endIndex: best.start + needle.length };
    }
  }

  const windowLength = Math.max(needle.length, 24);
  let bestFuzzy = { start: -1, score: 0 };
  const step = Math.max(1, Math.floor(windowLength / 8));
  for (let start = 0; start < pageText.length; start += step) {
    const candidate = pageText.slice(start, Math.min(pageText.length, start + windowLength));
    const score = tokenSimilarity(candidate, needle);
    if (score > bestFuzzy.score) bestFuzzy = { start, score };
  }
  if (bestFuzzy.score >= 0.72) {
    return { success: true, pageNumber: favorite.pageNumber, matchType: "fuzzy", rects: [], confidence: Math.min(0.77, 0.55 + bestFuzzy.score * 0.22), startIndex: bestFuzzy.start, endIndex: bestFuzzy.start + windowLength };
  }

  return { success: false, pageNumber: favorite.pageNumber, matchType: "page-only", rects: [], confidence: 0, startIndex: null, endIndex: null };
}

export function calculateHighlightRects(
  textLayer: HTMLElement,
  startIndex: number,
  endIndex: number,
): HighlightRect[] {
  const layerRect = textLayer.getBoundingClientRect();
  if (!layerRect.width || !layerRect.height) return [];
  const spans = Array.from(textLayer.querySelectorAll("span"));
  const rawParts: string[] = [];
  const rawPositions: Array<{ node: Text; offset: number } | null> = [];
  spans.forEach((span, spanIndex) => {
    const node = span.firstChild;
    const value = node?.nodeType === Node.TEXT_NODE ? node.textContent ?? "" : "";
    rawParts.push(value);
    if (node?.nodeType === Node.TEXT_NODE) {
      for (let offset = 0; offset < value.length; offset += 1) {
        rawPositions.push({ node: node as Text, offset });
      }
    } else {
      for (let offset = 0; offset < value.length; offset += 1) rawPositions.push(null);
    }
    if (spanIndex < spans.length - 1) {
      rawParts.push(" ");
      rawPositions.push(null);
    }
  });
  const normalized = normalizeTextWithMap(rawParts.join(""));
  const matchStart = Math.max(0, Math.min(startIndex, normalized.text.length - 1));
  const matchEnd = Math.max(matchStart + 1, Math.min(endIndex, normalized.text.length));
  let first: { node: Text; offset: number } | null = null;
  let last: { node: Text; offset: number } | null = null;
  for (let index = matchStart; index < matchEnd; index += 1) {
    const position = rawPositions[normalized.indexMap[index]];
    if (position) {
      first ??= position;
      last = position;
    }
  }
  const rects: HighlightRect[] = [];
  if (first && last) {
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, Math.min(last.node.length, last.offset + 1));
    Array.from(range.getClientRects()).forEach((rect) => {
      if (rect.width > 0 && rect.height > 0) {
        rects.push({
          x: Math.min(1, Math.max(0, (rect.left - layerRect.left) / layerRect.width)),
          y: Math.min(1, Math.max(0, (rect.top - layerRect.top) / layerRect.height)),
          width: Math.min(1, Math.max(0, rect.width / layerRect.width)),
          height: Math.min(1, Math.max(0, rect.height / layerRect.height)),
        });
      }
    });
  }
  return rects;
}
