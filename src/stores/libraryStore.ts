import { create } from "zustand";
import type { AppCommandError, Document } from "../core/models/document";
import { documentGateway } from "../platform/tauri/documentGateway";

type LibraryState = {
  documents: Document[];
  loading: boolean;
  importing: boolean;
  error: string | null;
  notice: string | null;
  loadDocuments: () => Promise<void>;
  chooseAndImport: () => Promise<void>;
  chooseAndImportFolder: () => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  renameDocument: (document: Document, title: string) => Promise<void>;
  toggleStar: (document: Document) => Promise<void>;
  clearFeedback: () => void;
};

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as AppCommandError).message);
  }
  return error instanceof Error ? error.message : String(error);
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  documents: [],
  loading: false,
  importing: false,
  error: null,
  notice: null,

  async loadDocuments() {
    set({ loading: true, error: null });
    try {
      const documents = await documentGateway.list();
      set({ documents, loading: false });
    } catch (error) {
      set({ loading: false, error: `无法读取本地资料库：${errorMessage(error)}` });
    }
  },

  async chooseAndImport() {
    set({ importing: true, error: null, notice: null });
    try {
      const paths = await documentGateway.pickPdfPaths();
      if (paths.length === 0) {
        set({ importing: false });
        return;
      }
      const summary = await documentGateway.import(paths);
      await get().loadDocuments();
      const parts = [];
      if (summary.imported.length) parts.push(`已添加 ${summary.imported.length} 个 PDF`);
      if (summary.duplicates.length) parts.push(`${summary.duplicates.length} 个已在资料库中`);
      if (summary.failed.length) parts.push(`${summary.failed.length} 个导入失败`);
      set({ importing: false, notice: parts.join("；") || "没有新增文件" });
    } catch (error) {
      set({ importing: false, error: `添加 PDF 失败：${errorMessage(error)}` });
    }
  },

  async chooseAndImportFolder() {
    set({ importing: true, error: null, notice: null });
    try {
      const path = await documentGateway.pickFolderPath();
      if (!path) {
        set({ importing: false });
        return;
      }
      const summary = await documentGateway.importFolder(path, true);
      await get().loadDocuments();
      set({
        importing: false,
        notice: `文件夹导入完成：新增 ${summary.imported.length}，重复 ${summary.duplicates.length}，失败 ${summary.failed.length}`,
      });
    } catch (error) {
      set({ importing: false, error: `导入文件夹失败：${errorMessage(error)}` });
    }
  },

  async removeDocument(id) {
    set({ error: null, notice: null });
    try {
      await documentGateway.remove(id);
      set((state) => ({
        documents: state.documents.filter((document) => document.id !== id),
        notice: "已从资料库移除记录；原 PDF 文件未被删除。",
      }));
    } catch (error) {
      set({ error: `移除失败：${errorMessage(error)}` });
    }
  },

  async renameDocument(document, title) {
    try {
      const updated = await documentGateway.rename(document.id, title);
      set((state) => ({
        documents: state.documents.map((item) => (item.id === updated.id ? updated : item)),
        notice: "显示标题已更新。",
      }));
    } catch (error) {
      set({ error: `修改标题失败：${errorMessage(error)}` });
    }
  },

  async toggleStar(document) {
    try {
      const updated = await documentGateway.setStarred(document.id, !document.isStarred);
      set((state) => ({
        documents: state.documents.map((item) => (item.id === updated.id ? updated : item)),
      }));
    } catch (error) {
      set({ error: `更新文件收藏状态失败：${errorMessage(error)}` });
    }
  },

  clearFeedback() {
    set({ error: null, notice: null });
  },
}));
