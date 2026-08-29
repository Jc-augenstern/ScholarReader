import { describe, expect, it } from "vitest";
import type { Favorite } from "../../core/models/favorite";
import { locateFavorite } from "./TextLocator";

function favorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: "fav", documentId: "doc", selectedText: "Recognition rather than recall.",
    normalizedText: "Recognition rather than recall.", pageNumber: 42,
    textStartIndex: null, textEndIndex: null, contextBefore: "Prefer visibility of system status.",
    contextAfter: "Minimize the user's memory load.", selectionRectsJson: "[]",
    documentHash: "a".repeat(64), locatorVersion: 1, note: "", createdAt: 1, updatedAt: 1,
    documentTitle: "HCI", filename: "hci.pdf", filepath: "D:/hci.pdf", tags: [], ...overrides,
  };
}

describe("locateFavorite", () => {
  it("uses stored position only when hash and text agree", () => {
    const text = "Intro Recognition rather than recall. End";
    const result = locateFavorite(text, favorite({ textStartIndex: 6, textEndIndex: 37, selectionRectsJson: '[{"x":0.1,"y":0.2,"width":0.3,"height":0.04}]' }), "a".repeat(64));
    expect(result.matchType).toBe("position");
    expect(result.confidence).toBe(1);
  });

  it("finds a unique exact match after whitespace normalization", () => {
    const result = locateFavorite("Intro  Recognition\n rather than recall. End", favorite(), "b".repeat(64));
    expect(result.matchType).toBe("exact");
    expect(result.confidence).toBe(0.95);
  });

  it("uses context to disambiguate a repeated sentence", () => {
    const text = "Other context. Recognition rather than recall. Other ending. Prefer visibility of system status. Recognition rather than recall. Minimize the user's memory load.";
    const result = locateFavorite(text, favorite(), "b".repeat(64));
    expect(result.matchType).toBe("context");
    expect(result.startIndex).toBeGreaterThan(60);
  });

  it("falls back to the page when confidence is too low", () => {
    const result = locateFavorite("Completely unrelated page text", favorite(), "b".repeat(64));
    expect(result).toMatchObject({ success: false, matchType: "page-only", confidence: 0 });
  });

  it("matches PDF item spacing around a hyphen", () => {
    const result = locateFavorite(
      "Human- Computer Interaction improves usability.",
      favorite({ selectedText: "Human-Computer Interaction", normalizedText: "Human-Computer Interaction" }),
      "b".repeat(64),
    );
    expect(result).toMatchObject({ success: true, matchType: "exact", confidence: 0.95 });
  });
});
