import { Copy, ExternalLink, FolderSearch, MapPin, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Favorite } from "../core/models/favorite";
import { documentGateway } from "../platform/tauri/documentGateway";
import { formatDate } from "../utils/format";

type FavoriteCardProps = {
  favorite: Favorite;
  onDelete: (favorite: Favorite) => void;
  onSave: (favorite: Favorite, note: string, tagNames: string[]) => Promise<void>;
};

export function FavoriteCard({ favorite, onDelete, onSave }: FavoriteCardProps) {
  const [note, setNote] = useState(favorite.note);
  const [tags, setTags] = useState(favorite.tags.map((tag) => tag.name).join(", "));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNote(favorite.note);
    setTags(favorite.tags.map((tag) => tag.name).join(", "));
    setDirty(false);
  }, [favorite]);

  useEffect(() => {
    if (!dirty) return;
    const timeout = window.setTimeout(() => {
      setSaving(true);
      const tagNames = tags.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
      void onSave(favorite, note, tagNames).finally(() => {
        setSaving(false);
        setDirty(false);
      });
    }, 750);
    return () => window.clearTimeout(timeout);
  }, [dirty, favorite, note, onSave, tags]);

  return (
    <article className="favorite-card">
      <blockquote>“{favorite.selectedText}”</blockquote>
      <div className="favorite-source">
        <strong>{favorite.documentTitle}</strong>
        <span>{favorite.filename} · 第 {favorite.pageNumber} 页 · {formatDate(favorite.createdAt)}</span>
      </div>
      <div className="favorite-tags">
        {favorite.tags.map((tag) => <span key={tag.id}>#{tag.name}</span>)}
      </div>
      <label className="favorite-field">
        <span>标签 <small>逗号分隔</small></span>
        <input
          aria-label="收藏标签"
          onChange={(event) => { setTags(event.target.value); setDirty(true); }}
          placeholder="HCI, UX, 考试重点"
          value={tags}
        />
      </label>
      <label className="favorite-field">
        <span>学习备注 {saving ? <small>保存中…</small> : dirty ? <small>等待自动保存</small> : <small><Save size={10} />已保存</small>}</span>
        <textarea
          aria-label="收藏备注"
          onChange={(event) => { setNote(event.target.value); setDirty(true); }}
          placeholder="写下你的理解、疑问或复习提示…"
          rows={3}
          value={note}
        />
      </label>
      <div className="favorite-actions">
        <Link className="favorite-primary-action" to={`/reader/${favorite.documentId}?favorite=${favorite.id}&page=${favorite.pageNumber}`}>
          <MapPin size={14} />回到原文
        </Link>
        <Link to={`/reader/${favorite.documentId}?page=${favorite.pageNumber}`}><ExternalLink size={13} />打开文件</Link>
        <button onClick={() => void documentGateway.openExternal(favorite.documentId)} type="button"><ExternalLink size={13} />系统打开</button>
        <button onClick={() => void documentGateway.reveal(favorite.documentId)} type="button"><FolderSearch size={13} />文件位置</button>
        <button onClick={() => void navigator.clipboard.writeText(favorite.selectedText)} type="button"><Copy size={13} />复制原文</button>
        <button className="danger-action" onClick={() => onDelete(favorite)} type="button"><Trash2 size={13} />删除</button>
      </div>
    </article>
  );
}
