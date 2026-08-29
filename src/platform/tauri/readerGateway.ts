import { invoke } from "@tauri-apps/api/core";
import type { ReadingProgress, ZoomMode } from "../../core/models/document";
import { isDesktopRuntime } from "./runtime";

export const readerGateway = {
  async readBytes(documentId: string): Promise<Uint8Array> {
    if (!isDesktopRuntime() && import.meta.env.DEV && documentId === "preview") {
      const response = await fetch("/fixtures/reader-smoke-test.pdf");
      if (!response.ok) throw new Error("无法读取开发预览 PDF");
      return new Uint8Array(await response.arrayBuffer());
    }
    const response = await invoke<ArrayBuffer>("read_document_bytes", { id: documentId });
    return new Uint8Array(response);
  },

  getProgress(documentId: string): Promise<ReadingProgress | null> {
    if (!isDesktopRuntime() && import.meta.env.DEV && documentId === "preview") {
      return Promise.resolve(null);
    }
    return invoke<ReadingProgress | null>("get_reading_progress", { documentId });
  },

  saveProgress(input: {
    documentId: string;
    pageNumber: number;
    pageOffsetRatio: number;
    zoomMode: ZoomMode;
    zoomValue: number;
    rotation: 0 | 90 | 180 | 270;
  }): Promise<ReadingProgress> {
    if (!isDesktopRuntime() && import.meta.env.DEV && input.documentId === "preview") {
      return Promise.resolve({ ...input, updatedAt: Date.now() });
    }
    return invoke<ReadingProgress>("save_reading_progress", input);
  },
};
