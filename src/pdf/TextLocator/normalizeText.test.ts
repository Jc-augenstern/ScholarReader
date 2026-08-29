import { describe, expect, it } from "vitest";
import { normalizeText, normalizeTextWithMap } from "./normalizeText";

describe("normalizeText", () => {
  it("folds whitespace and Unicode spaces", () => {
    expect(normalizeText("Recognition\u00a0  rather\nthan recall.")).toBe(
      "Recognition rather than recall.",
    );
  });

  it("joins conservative hyphenated line breaks", () => {
    expect(normalizeText("Human-\nComputer Interaction")).toBe(
      "Human-Computer Interaction",
    );
  });

  it("joins PDF text-item whitespace after a hyphen", () => {
    expect(normalizeText("Human- Computer Interaction")).toBe("Human-Computer Interaction");
  });

  it("keeps a source index map while folding whitespace", () => {
    const result = normalizeTextWithMap("A  B");
    expect(result.text).toBe("A B");
    expect(result.indexMap).toEqual([0, 1, 3]);
  });
});
