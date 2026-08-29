import { afterEach, describe, expect, it } from "vitest";
import {
  resolveTextLayerCaretAtPoint,
  snapSelectionToEnglishWordBoundaries,
} from "./selectionAcquisition";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function select(start: Text, startOffset: number, end: Text, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("PDF selection acquisition", () => {
  it("snaps a partial English word split across adjacent PDF.js text nodes", () => {
    const layer = document.createElement("div");
    const left = document.createElement("span");
    const right = document.createElement("span");
    left.textContent = "inter";
    right.textContent = "action";
    layer.append(left, right);
    document.body.append(layer);

    const selection = select(left.firstChild as Text, 2, right.firstChild as Text, 3);
    const result = snapSelectionToEnglishWordBoundaries(layer, selection);

    expect(result).toEqual({ rawText: "teract", snappedText: "interaction", changed: true });
    expect(selection.toString()).toBe("interaction");
  });

  it("snaps both endpoints of a multi-word English selection", () => {
    const layer = document.createElement("div");
    const node = document.createTextNode("The interaction technique significantly improves usability.");
    layer.append(node);
    document.body.append(layer);
    const raw = "raction technique significantly impro";
    const start = node.data.indexOf(raw);
    const selection = select(node, start, node, start + raw.length);

    const result = snapSelectionToEnglishWordBoundaries(layer, selection);

    expect(result?.rawText).toBe(raw);
    expect(result?.snappedText).toBe("interaction technique significantly improves");
  });

  it("does not expand Chinese selections", () => {
    const layer = document.createElement("div");
    const node = document.createTextNode("智能交互设计");
    layer.append(node);
    document.body.append(layer);
    const selection = select(node, 2, node, 4);

    const result = snapSelectionToEnglishWordBoundaries(layer, selection);

    expect(result).toEqual({ rawText: "交互", snappedText: "交互", changed: false });
    expect(selection.toString()).toBe("交互");
  });

  it("maps points within eight pixels of a text edge but rejects distant points", () => {
    const layer = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "interaction";
    layer.append(span);
    document.body.append(layer);
    Object.defineProperty(span, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 40, right: 190, bottom: 60, width: 90, height: 20 }),
    });

    const left = resolveTextLayerCaretAtPoint(layer, 94, 50);
    const right = resolveTextLayerCaretAtPoint(layer, 196, 50);

    expect(left).toMatchObject({ node: span.firstChild, offset: 0, assisted: true, distance: 6 });
    expect(right).toMatchObject({ node: span.firstChild, offset: 11, assisted: true, distance: 6 });
    expect(resolveTextLayerCaretAtPoint(layer, 88, 50)).toBeNull();
  });
});
