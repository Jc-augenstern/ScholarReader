import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Document } from "../core/models/document";
import { useLibraryStore } from "../stores/libraryStore";
import { LibraryPage } from "./LibraryPage";

function documentFixture(id: string, title: string): Document {
  return {
    id,
    title,
    filename: `${title}.pdf`,
    filepath: `D:\\Papers\\${title}.pdf`,
    fileHash: id.padEnd(64, "0"),
    fileSize: 2_048,
    pageCount: 12,
    readingPage: 3,
    isStarred: false,
    createdAt: 1_787_500_000_000,
    lastOpenedAt: null,
    updatedAt: 1_787_500_000_000,
  };
}

function renderLibrary(documents: Document[]) {
  useLibraryStore.setState({ documents, loading: false, importing: false });
  return render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  );
}

describe("LibraryPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useLibraryStore.setState({
      documents: [],
      loading: false,
      importing: false,
      error: null,
      notice: null,
    });
  });

  it("renders the empty library state", () => {
    renderLibrary([]);
    expect(screen.getByRole("heading", { name: "建立你的学习资料库" })).toBeInTheDocument();
  });

  it("renders one persisted PDF", () => {
    renderLibrary([documentFixture("one", "Attention Is All You Need")]);
    expect(screen.getByRole("heading", { name: "Attention Is All You Need" })).toBeInTheDocument();
    expect(screen.getByText("Attention Is All You Need.pdf")).toBeInTheDocument();
    expect(screen.getByText("1 个文档")).toBeInTheDocument();
  });

  it("renders multiple persisted PDFs", () => {
    renderLibrary([
      documentFixture("one", "Paper One"),
      documentFixture("two", "Paper Two"),
      documentFixture("three", "Paper Three"),
    ]);
    expect(screen.getByRole("heading", { name: "Paper One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paper Two" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Paper Three" })).toBeInTheDocument();
    expect(screen.getByText("3 个文档")).toBeInTheDocument();
  });
});
