import { describe, expect, it, vi } from "vitest";
import "./mapUpsert";

describe("Map Upsert compatibility", () => {
  it("inserts a computed value once and reuses it", () => {
    const map = new Map<string, number>();
    const compute = vi.fn(() => 42);

    expect(map.getOrInsertComputed("answer", compute)).toBe(42);
    expect(map.getOrInsertComputed("answer", compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not replace an existing undefined value", () => {
    const map = new Map<string, number | undefined>([["present", undefined]]);
    const compute = vi.fn(() => 7);

    expect(map.getOrInsertComputed("present", compute)).toBeUndefined();
    expect(compute).not.toHaveBeenCalled();
  });
});
