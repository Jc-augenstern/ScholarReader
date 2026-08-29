import { Merge, Pencil, Tag as TagIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { TagSummary } from "../core/models/favorite";
import { favoriteGateway } from "../platform/tauri/favoriteGateway";
import { Link } from "react-router-dom";

export function TagsPage() {
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void favoriteGateway.listTags().then(setTags).catch((reason) => setError(String(reason)));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="page tags-page">
      <div className="page-heading">
        <div><span className="eyebrow">本地整理</span><h1>标签</h1><p>标签由收藏创建，可重命名、合并或删除。</p></div>
      </div>
      {error ? <div className="favorites-error">{error}</div> : null}
      {tags.length ? (
        <div className="tag-grid">
          {tags.map((tag) => (
            <article className="tag-card" key={tag.id}>
              <div className="tag-symbol"><TagIcon size={17} /></div>
              <Link className="tag-copy" to={`/favorites?tag=${encodeURIComponent(tag.name)}`}><strong>#{tag.name}</strong><span>{tag.favoriteCount} 条收藏</span></Link>
              <div className="tag-actions">
                <button aria-label={`重命名 ${tag.name}`} onClick={() => {
                  const name = window.prompt("新的标签名称", tag.name)?.trim();
                  if (!name || name === tag.name) return;
                  void favoriteGateway.renameTag(tag.id, name).then(load).catch((reason) => setError(String(reason)));
                }} type="button"><Pencil size={13} /></button>
                <button aria-label={`合并 ${tag.name}`} disabled={tags.length < 2} onClick={() => {
                  const targetName = window.prompt(`将 #${tag.name} 合并到哪个标签？`, tags.find((item) => item.id !== tag.id)?.name)?.trim().toLocaleLowerCase();
                  const target = tags.find((item) => item.name.toLocaleLowerCase() === targetName);
                  if (!target || target.id === tag.id) return;
                  void favoriteGateway.mergeTags(tag.id, target.id).then(load).catch((reason) => setError(String(reason)));
                }} type="button"><Merge size={13} /></button>
                <button aria-label={`删除 ${tag.name}`} onClick={() => {
                  if (!window.confirm(`删除标签 #${tag.name}？收藏原文不会被删除。`)) return;
                  void favoriteGateway.deleteTag(tag.id).then(load).catch((reason) => setError(String(reason)));
                }} type="button"><Trash2 size={13} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state"><div className="empty-illustration"><TagIcon size={28} /></div><h2>还没有标签</h2><p>在收藏卡片中输入标签，系统会自动创建并归类。</p></div>
      )}
    </div>
  );
}
