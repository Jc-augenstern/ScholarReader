import { Search, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FavoriteCard } from "../components/FavoriteCard";
import type { Favorite } from "../core/models/favorite";
import { favoriteGateway } from "../platform/tauri/favoriteGateway";

export function FavoritesPage() {
  // Querying stays document-independent here so the full local collection remains searchable.
  const [query, setQuery] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const tagFilter = searchParams.get("tag") ?? "";
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const visibleFavorites = useMemo(() => tagFilter
    ? favorites.filter((favorite) => favorite.tags.some((tag) => tag.name.toLocaleLowerCase() === tagFilter.toLocaleLowerCase()))
    : favorites, [favorites, tagFilter]);

  const load = useCallback(async (nextQuery = query) => {
    setLoading(true);
    setError(null);
    try {
      setFavorites(await favoriteGateway.list(nextQuery));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(query), 220);
    return () => window.clearTimeout(timeout);
  }, [load, query]);

  const save = useCallback(async (favorite: Favorite, note: string, tagNames: string[]) => {
    const updated = await favoriteGateway.update({ id: favorite.id, note, tagNames });
    setFavorites((items) => items.map((item) => (item.id === updated.id ? updated : item)));
  }, []);

  const remove = useCallback((favorite: Favorite) => {
    if (!window.confirm("删除这条收藏？该操作不会修改原 PDF。")) return;
    void favoriteGateway.remove(favorite.id).then(() => {
      setFavorites((items) => items.filter((item) => item.id !== favorite.id));
    });
  }, []);

  return (
    <div className="page favorites-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">学习摘录</span>
          <h1>收藏</h1>
          <p>原文、来源、标签和备注全部保存在本地。</p>
        </div>
      </div>
      <label className="search-box favorite-search">
        <Search size={17} />
        <input aria-label="搜索收藏" onChange={(event) => setQuery(event.target.value)} placeholder="搜索原文、备注、标签、标题或文件名" type="search" value={query} />
      </label>
      {tagFilter ? <div className="active-filter">正在筛选 <strong>#{tagFilter}</strong><button onClick={() => setSearchParams({})} type="button">清除</button></div> : null}
      {error ? <div className="favorites-error">读取收藏失败：{error}</div> : null}
      {loading ? <div className="loading-panel"><span className="spinner dark" />正在读取收藏…</div> : null}
      {!loading && visibleFavorites.length ? (
        <div className="favorite-list">
          {visibleFavorites.map((favorite) => <FavoriteCard favorite={favorite} key={favorite.id} onDelete={remove} onSave={save} />)}
        </div>
      ) : null}
      {!loading && !visibleFavorites.length ? (
        <div className="empty-state favorites-empty">
          <div className="empty-illustration"><Star size={30} /></div>
          <h2>{query ? "没有匹配的收藏" : "还没有收藏原文"}</h2>
          <p>{query ? "尝试搜索其他关键词、标签或文件名。" : "在 PDF 中选择文字后点击“收藏”，无需 AI，也可以随时回到原文。"}</p>
          <div className="offline-badge">完全离线可用</div>
        </div>
      ) : null}
    </div>
  );
}
