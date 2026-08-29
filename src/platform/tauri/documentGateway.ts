import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Document, ImportSummary, RebindCandidate } from "../../core/models/document";
import { isDesktopRuntime } from "./runtime";

const previewDocument: Document = {
  id: "preview",
  title: "ScholarReader Reader Smoke Test",
  filename: "reader-smoke-test.pdf",
  filepath: "开发预览夹具（不写入资料库）",
  fileHash: "0".repeat(64),
  fileSize: 4476,
  pageCount: 4,
  readingPage: 1,
  isStarred: false,
  createdAt: 0,
  lastOpenedAt: null,
  updatedAt: 0,
};

export const documentGateway = {
  list(): Promise<Document[]> {
    if (!isDesktopRuntime()) return Promise.resolve([]);
    return invoke<Document[]>("list_documents");
  },

  async pickPdfPaths(): Promise<string[]> {
    if (!isDesktopRuntime()) return [];
    const result = await open({
      multiple: true,
      directory: false,
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  },

  async pickFolderPath(): Promise<string | null> {
    if (!isDesktopRuntime()) return null;
    const result = await open({ multiple: false, directory: true, title: "选择包含 PDF 的文件夹" });
    return typeof result === "string" ? result : null;
  },

  async pickSinglePdfPath(): Promise<string | null> {
    if (!isDesktopRuntime()) return null;
    const result = await open({
      multiple: false,
      directory: false,
      title: "重新定位原始 PDF",
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    return typeof result === "string" ? result : null;
  },

  import(paths: string[]): Promise<ImportSummary> {
    return invoke<ImportSummary>("import_documents", { paths });
  },

  importFolder(path: string, recursive = true): Promise<ImportSummary> {
    return invoke<ImportSummary>("import_pdf_folder", { path, recursive });
  },

  get(id: string): Promise<Document> {
    if (!isDesktopRuntime() && import.meta.env.DEV && id === "preview") {
      return Promise.resolve(previewDocument);
    }
    return invoke<Document>("get_document", { id });
  },

  setPageCount(id: string, pageCount: number): Promise<Document> {
    if (!isDesktopRuntime() && import.meta.env.DEV && id === "preview") {
      return Promise.resolve({ ...previewDocument, pageCount });
    }
    return invoke<Document>("set_document_page_count", { id, pageCount });
  },

  remove(id: string): Promise<boolean> {
    return invoke<boolean>("remove_document", { id });
  },

  setStarred(id: string, starred: boolean): Promise<Document> {
    return invoke<Document>("set_document_starred", { id, starred });
  },

  rename(id: string, title: string): Promise<Document> {
    return invoke<Document>("rename_document", { id, title });
  },

  openExternal(id: string): Promise<void> {
    return invoke<void>("open_document_external", { id });
  },

  reveal(id: string): Promise<void> {
    return invoke<void>("reveal_document_in_manager", { id });
  },

  checkRebind(id: string, path: string): Promise<RebindCandidate> {
    return invoke<RebindCandidate>("check_rebind_candidate", { id, path });
  },

  rebind(id: string, path: string, allowChanged: boolean): Promise<Document> {
    return invoke<Document>("rebind_document", { id, path, allowChanged });
  },
};
