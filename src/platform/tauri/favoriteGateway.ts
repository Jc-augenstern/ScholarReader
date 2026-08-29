import { invoke } from "@tauri-apps/api/core";
import type {
  CreateFavoriteInput,
  Favorite,
  TagSummary,
  UpdateFavoriteInput,
} from "../../core/models/favorite";
import { isDesktopRuntime } from "./runtime";

// Browser-only smoke data exercises the real favorite/highlight UI without touching desktop data.
let previewFavorites: Favorite[] = import.meta.env.DEV ? [{
  id: "preview-favorite-recognition",
  documentId: "preview",
  selectedText: "Recognition rather than recall.",
  normalizedText: "Recognition rather than recall.",
  pageNumber: 1,
  textStartIndex: null,
  textEndIndex: null,
  contextBefore: "A practical usability principle is",
  contextAfter: "Interfaces should make actions and choices visible.",
  selectionRectsJson: "[]",
  documentHash: "0".repeat(64),
  locatorVersion: 1,
  note: "浏览器预览夹具：验证收藏定位、高亮与备注编辑。",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  documentTitle: "ScholarReader Reader Smoke Test",
  filename: "reader-smoke-test.pdf",
  filepath: "开发预览夹具（不写入资料库）",
  tags: [{ id: "preview-hci", name: "HCI", createdAt: Date.now() }],
}] : [];

export const favoriteGateway = {
  get(id: string): Promise<Favorite> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const favorite = previewFavorites.find((item) => item.id === id);
      return favorite ? Promise.resolve(favorite) : Promise.reject(new Error("收藏不存在"));
    }
    return invoke<Favorite>("get_favorite", { id });
  },

  list(query?: string, documentId?: string): Promise<Favorite[]> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const needle = query?.trim().toLocaleLowerCase() ?? "";
      return Promise.resolve(
        previewFavorites.filter((favorite) =>
          (!documentId || favorite.documentId === documentId) &&
          (!needle || [favorite.selectedText, favorite.note, favorite.documentTitle, favorite.filename, ...favorite.tags.map((tag) => tag.name)].some((value) => value.toLocaleLowerCase().includes(needle))),
        ),
      );
    }
    return invoke<Favorite[]>("list_favorites", { query: query || null, documentId: documentId || null });
  },

  create(input: CreateFavoriteInput): Promise<Favorite> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const now = Date.now();
      const favorite: Favorite = {
        ...input,
        id: crypto.randomUUID(),
        documentHash: "0".repeat(64),
        locatorVersion: 1,
        note: "",
        createdAt: now,
        updatedAt: now,
        documentTitle: "ScholarReader Reader Smoke Test",
        filename: "reader-smoke-test.pdf",
        filepath: "开发预览夹具（不写入资料库）",
        tags: [],
      };
      previewFavorites = [favorite, ...previewFavorites];
      return Promise.resolve(favorite);
    }
    return invoke<Favorite>("create_favorite", { input });
  },

  update(input: UpdateFavoriteInput): Promise<Favorite> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const favorite = previewFavorites.find((item) => item.id === input.id);
      if (!favorite) return Promise.reject(new Error("收藏不存在"));
      const updated: Favorite = {
        ...favorite,
        note: input.note,
        updatedAt: Date.now(),
        tags: input.tagNames.map((name) => ({ id: name.toLocaleLowerCase(), name, createdAt: Date.now() })),
      };
      previewFavorites = previewFavorites.map((item) => (item.id === input.id ? updated : item));
      return Promise.resolve(updated);
    }
    return invoke<Favorite>("update_favorite", { input });
  },

  remove(id: string): Promise<boolean> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      previewFavorites = previewFavorites.filter((item) => item.id !== id);
      return Promise.resolve(true);
    }
    return invoke<boolean>("delete_favorite", { id });
  },

  listTags(): Promise<TagSummary[]> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const counts = new Map<string, TagSummary>();
      previewFavorites.flatMap((favorite) => favorite.tags).forEach((tag) => {
        const current = counts.get(tag.id);
        counts.set(tag.id, { ...tag, favoriteCount: (current?.favoriteCount ?? 0) + 1 });
      });
      return Promise.resolve([...counts.values()]);
    }
    return invoke<TagSummary[]>("list_tags");
  },

  renameTag(id: string, name: string): Promise<TagSummary> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const now = Date.now();
      previewFavorites = previewFavorites.map((favorite) => ({
        ...favorite,
        tags: favorite.tags.map((tag) => (tag.id === id ? { ...tag, name } : tag)),
      }));
      const count = previewFavorites.filter((favorite) => favorite.tags.some((tag) => tag.id === id)).length;
      return Promise.resolve({ id, name, createdAt: now, favoriteCount: count });
    }
    return invoke<TagSummary>("rename_tag", { id, name });
  },

  deleteTag(id: string): Promise<boolean> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      previewFavorites = previewFavorites.map((favorite) => ({
        ...favorite,
        tags: favorite.tags.filter((tag) => tag.id !== id),
      }));
      return Promise.resolve(true);
    }
    return invoke<boolean>("delete_tag", { id });
  },

  mergeTags(sourceId: string, targetId: string): Promise<boolean> {
    if (!isDesktopRuntime() && import.meta.env.DEV) {
      const target = previewFavorites.flatMap((favorite) => favorite.tags).find((tag) => tag.id === targetId);
      if (!target) return Promise.reject(new Error("目标标签不存在"));
      previewFavorites = previewFavorites.map((favorite) => {
        if (!favorite.tags.some((tag) => tag.id === sourceId)) return favorite;
        const tags = favorite.tags.filter((tag) => tag.id !== sourceId);
        if (!tags.some((tag) => tag.id === targetId)) tags.push(target);
        return { ...favorite, tags };
      });
      return Promise.resolve(true);
    }
    return invoke<boolean>("merge_tags", { sourceId, targetId });
  },
};
