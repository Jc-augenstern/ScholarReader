import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyLibrary } from "./EmptyLibrary";

describe("EmptyLibrary", () => {
  it("starts PDF import from the primary action", () => {
    const onAdd = vi.fn();
    render(<EmptyLibrary importing={false} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "添加第一个 PDF" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});
