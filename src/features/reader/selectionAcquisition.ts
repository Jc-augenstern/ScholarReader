const LATIN_WORD_CHARACTER = /[\p{Script=Latin}\p{Mark}\p{Number}_'’-]/u;

export const TEXT_SELECTION_HIT_SLOP_PX = 8;

export type TextCaret = {
  node: Text;
  offset: number;
  assisted: boolean;
  distance: number;
};

export type SelectionSnapResult = {
  rawText: string;
  snappedText: string;
  changed: boolean;
};

function textNodesIn(layer: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.textContent) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function firstTextNode(node: Node | undefined): Text | null {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

function lastTextNode(node: Node | undefined): Text | null {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  let last = current;
  while (current) {
    last = current;
    current = walker.nextNode() as Text | null;
  }
  return last;
}

function boundaryToTextCaret(
  layer: HTMLElement,
  nodes: Text[],
  container: Node,
  offset: number,
  edge: "start" | "end",
): TextCaret | null {
  if (container.nodeType === Node.TEXT_NODE) {
    const node = container as Text;
    if (!layer.contains(node)) return null;
    return {
      node,
      offset: Math.max(0, Math.min(offset, node.data.length)),
      assisted: false,
      distance: 0,
    };
  }
  if (!(container instanceof Element) || !layer.contains(container)) return null;

  const children = Array.from(container.childNodes);
  const direct = edge === "start"
    ? firstTextNode(children[offset])
    : lastTextNode(children[Math.max(0, offset - 1)]);
  if (direct) {
    return {
      node: direct,
      offset: edge === "start" ? 0 : direct.data.length,
      assisted: false,
      distance: 0,
    };
  }

  const boundary = document.createRange();
  boundary.setStart(container, Math.max(0, Math.min(offset, children.length)));
  boundary.collapse(true);
  const ordered = edge === "start" ? nodes : [...nodes].reverse();
  for (const node of ordered) {
    const candidate = document.createRange();
    candidate.selectNodeContents(node);
    const relation = boundary.compareBoundaryPoints(
      edge === "start" ? Range.START_TO_START : Range.START_TO_END,
      candidate,
    );
    if ((edge === "start" && relation <= 0) || (edge === "end" && relation >= 0)) {
      return {
        node,
        offset: edge === "start" ? 0 : node.data.length,
        assisted: false,
        distance: 0,
      };
    }
  }
  return null;
}

function characterRect(node: Text, offset: number): DOMRect | null {
  if (offset < 0 || offset >= node.data.length) return null;
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function hasLineBreakBetween(left: Text, right: Text): boolean {
  try {
    const bridge = document.createRange();
    bridge.setStart(left, left.data.length);
    bridge.setEnd(right, 0);
    return Boolean(bridge.cloneContents().querySelector("br"));
  } catch {
    return true;
  }
}

function textNodesFormOneWord(left: Text, right: Text): boolean {
  if (hasLineBreakBetween(left, right)) return false;
  const leftRect = characterRect(left, left.data.length - 1);
  const rightRect = characterRect(right, 0);
  if (!leftRect || !rightRect) return true;
  const overlap = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
  const minimumHeight = Math.min(leftRect.height, rightRect.height);
  const gap = rightRect.left - leftRect.right;
  return overlap >= minimumHeight * 0.55 && gap >= -2 && gap <= Math.max(2, minimumHeight * 0.18);
}

function isLatinWordCharacter(value: string | undefined): boolean {
  return Boolean(value && LATIN_WORD_CHARACTER.test(value));
}

function normalizeStart(nodes: Text[], point: TextCaret): TextCaret {
  let index = nodes.indexOf(point.node);
  let offset = point.offset;
  while (index >= 0 && index < nodes.length && offset >= nodes[index].data.length) {
    index += 1;
    offset = 0;
  }
  return index < nodes.length ? { ...point, node: nodes[index], offset } : point;
}

function normalizeEnd(nodes: Text[], point: TextCaret): TextCaret {
  let index = nodes.indexOf(point.node);
  let offset = point.offset;
  while (index > 0 && offset === 0) {
    index -= 1;
    offset = nodes[index].data.length;
  }
  return { ...point, node: nodes[index], offset };
}

function expandStart(nodes: Text[], initial: TextCaret): TextCaret {
  let point = normalizeStart(nodes, initial);
  let index = nodes.indexOf(point.node);
  if (index < 0 || !isLatinWordCharacter(point.node.data[point.offset])) return point;

  while (true) {
    while (point.offset > 0 && isLatinWordCharacter(point.node.data[point.offset - 1])) {
      point = { ...point, offset: point.offset - 1 };
    }
    if (point.offset > 0 || index === 0) return point;
    const previous = nodes[index - 1];
    if (
      !isLatinWordCharacter(previous.data[previous.data.length - 1]) ||
      !textNodesFormOneWord(previous, point.node)
    ) return point;
    index -= 1;
    point = { ...point, node: previous, offset: previous.data.length };
  }
}

function expandEnd(nodes: Text[], initial: TextCaret): TextCaret {
  let point = normalizeEnd(nodes, initial);
  let index = nodes.indexOf(point.node);
  if (index < 0 || point.offset === 0 || !isLatinWordCharacter(point.node.data[point.offset - 1])) {
    return point;
  }

  while (true) {
    while (point.offset < point.node.data.length && isLatinWordCharacter(point.node.data[point.offset])) {
      point = { ...point, offset: point.offset + 1 };
    }
    if (point.offset < point.node.data.length || index >= nodes.length - 1) return point;
    const next = nodes[index + 1];
    if (!isLatinWordCharacter(next.data[0]) || !textNodesFormOneWord(point.node, next)) return point;
    index += 1;
    point = { ...point, node: next, offset: 0 };
  }
}

export function snapSelectionToEnglishWordBoundaries(
  textLayer: HTMLElement,
  selection: Selection | null = window.getSelection(),
): SelectionSnapResult | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const originalRange = selection.getRangeAt(0);
  if (
    !textLayer.contains(originalRange.startContainer) ||
    !textLayer.contains(originalRange.endContainer)
  ) return null;

  const nodes = textNodesIn(textLayer);
  const rawText = selection.toString();
  const start = boundaryToTextCaret(
    textLayer,
    nodes,
    originalRange.startContainer,
    originalRange.startOffset,
    "start",
  );
  const end = boundaryToTextCaret(
    textLayer,
    nodes,
    originalRange.endContainer,
    originalRange.endOffset,
    "end",
  );
  if (!start || !end) return { rawText, snappedText: rawText, changed: false };

  const expandedStart = expandStart(nodes, start);
  const expandedEnd = expandEnd(nodes, end);
  const snappedRange = document.createRange();
  snappedRange.setStart(expandedStart.node, expandedStart.offset);
  snappedRange.setEnd(expandedEnd.node, expandedEnd.offset);
  selection.removeAllRanges();
  selection.addRange(snappedRange);
  const snappedText = selection.toString();
  return { rawText, snappedText, changed: rawText !== snappedText };
}

type BrowserDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function nativeCaretAtPoint(
  layer: HTMLElement,
  nodes: Text[],
  clientX: number,
  clientY: number,
): TextCaret | null {
  const browserDocument = document as BrowserDocument;
  const position = browserDocument.caretPositionFromPoint?.(clientX, clientY);
  if (position) {
    return boundaryToTextCaret(layer, nodes, position.offsetNode, position.offset, "start");
  }
  const range = browserDocument.caretRangeFromPoint?.(clientX, clientY);
  return range
    ? boundaryToTextCaret(layer, nodes, range.startContainer, range.startOffset, "start")
    : null;
}

export function resolveTextLayerCaretAtPoint(
  textLayer: HTMLElement,
  clientX: number,
  clientY: number,
  slop = TEXT_SELECTION_HIT_SLOP_PX,
): TextCaret | null {
  const nodes = textNodesIn(textLayer);
  if (!nodes.length) return null;
  const spans = Array.from(textLayer.querySelectorAll("span"));
  let best: { span: HTMLSpanElement; rect: DOMRect; distance: number; outside: boolean } | null = null;

  for (const span of spans) {
    const rect = span.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (clientY < rect.top - 2 || clientY > rect.bottom + 2) continue;
    const horizontalDistance = clientX < rect.left
      ? rect.left - clientX
      : clientX > rect.right
        ? clientX - rect.right
        : 0;
    if (horizontalDistance > slop) continue;
    const verticalDistance = Math.abs(clientY - (rect.top + rect.bottom) / 2) / Math.max(1, rect.height);
    const score = horizontalDistance + verticalDistance;
    if (!best || score < best.distance) {
      best = {
        span,
        rect,
        distance: score,
        outside: clientX < rect.left || clientX > rect.right,
      };
    }
  }
  if (!best) return null;

  if (!best.outside) {
    const native = nativeCaretAtPoint(textLayer, nodes, clientX, clientY);
    if (native) return { ...native, assisted: false, distance: 0 };
  }

  const atStart = clientX <= best.rect.left;
  const edgeNode = atStart ? firstTextNode(best.span) : lastTextNode(best.span);
  if (!edgeNode) return null;
  return {
    node: edgeNode,
    offset: atStart ? 0 : edgeNode.data.length,
    assisted: best.outside,
    distance: Math.max(0, clientX < best.rect.left ? best.rect.left - clientX : clientX - best.rect.right),
  };
}

export function setSelectionBaseAndExtent(anchor: TextCaret, focus: TextCaret): void {
  const selection = window.getSelection();
  if (!selection) return;
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return;
  }
  const range = document.createRange();
  try {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
  } catch {
    range.setStart(focus.node, focus.offset);
    range.setEnd(anchor.node, anchor.offset);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}
