import { afterEach, describe, expect, it } from "vitest";
import { captureSelection } from "./captureSelection";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

describe("captureSelection", () => {
  it("captures normalized text, context, indexes, and page-relative rects", () => {
    const layer = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "Recognition rather than recall.";
    layer.append(span);
    document.body.append(layer);
    Object.defineProperty(layer, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 50, right: 700, bottom: 850, width: 600, height: 800 }),
    });
    const textNode = span.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.textContent!.length);
    Object.defineProperty(range, "getClientRects", {
      value: () => [{ left: 160, top: 130, right: 460, bottom: 150, width: 300, height: 20 }],
    });
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 160, top: 130, right: 460, bottom: 150, width: 300, height: 20 }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const result = captureSelection(
      layer,
      "doc-1",
      42,
      "Prefer visibility. Recognition rather than recall. Minimize memory load.",
    );

    expect(result).toMatchObject({
      documentId: "doc-1",
      pageNumber: 42,
      selectedText: "Recognition rather than recall.",
      normalizedText: "Recognition rather than recall.",
      textStartIndex: 19,
      textEndIndex: 50,
    });
    expect(result?.rects[0]).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.025 });
  });

  it("rejects a range that leaves the active text layer", () => {
    const layer = document.createElement("div");
    const inside = document.createTextNode("inside");
    const outside = document.createTextNode("outside");
    layer.append(inside);
    document.body.append(layer, outside);
    const range = document.createRange();
    range.setStart(inside, 0);
    range.setEnd(outside, outside.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureSelection(layer, "doc", 1, "inside outside")).toBeNull();
  });

  it("records the selected occurrence when the same sentence repeats", () => {
    const layer = document.createElement("div");
    const first = document.createElement("span");
    const second = document.createElement("span");
    first.textContent = "Repeat. ";
    second.textContent = "Repeat.";
    layer.append(first, second);
    document.body.append(layer);
    Object.defineProperty(layer, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }),
    });
    const range = document.createRange();
    range.selectNodeContents(second);
    Object.defineProperty(range, "getClientRects", {
      value: () => [{ left: 80, top: 10, right: 140, bottom: 30, width: 60, height: 20 }],
    });
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 80, top: 10, right: 140, bottom: 30, width: 60, height: 20 }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const result = captureSelection(layer, "doc", 1, "Repeat. Repeat.");
    expect(result?.textStartIndex).toBe(8);
    expect(result?.textEndIndex).toBe(15);
  });
});
