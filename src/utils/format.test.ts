import { describe, expect, it } from "vitest";
import { formatFileSize } from "./format";

describe("formatFileSize", () => {
  it("uses readable binary units", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
