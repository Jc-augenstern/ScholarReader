import { Copy, ExternalLink, FileText, FolderSearch, MoreHorizontal, Pencil, Star } from "lucide-react";
import { useRef } from "react";
import type { Document } from "../core/models/document";
import { formatDate, formatFileSize } from "../utils/format";
import { Link } from "react-router-dom";
import { documentGateway } from "../platform/tauri/documentGateway";

type DocumentCardProps = {
  document: Document;
  onRemove: (document: Document) => void;
  onToggleStar: (document: Document) => void;
  onRename: (document: Document, title: string) => void;
};

export function DocumentCard({ document, onRemove, onRename, onToggleStar }: DocumentCardProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const progress = document.pageCount && document.readingPage
    ? Math.min(100, Math.max(0, (document.readingPage / document.pageCount) * 100))
    : 0;
  return (
    <article className="document-card" onContextMenu={(event) => { event.preventDefault(); if (menuRef.current) menuRef.current.open = true; }}>
      <Link className="document-open-link" to={`/reader/${document.id}`} aria-label={`打开 ${document.title}`} />
      <div className="pdf-icon" aria-hidden="true">
        <FileText size={22} />
        <span>PDF</span>
      </div>
      <div className="document-copy">
        <div className="document-title-row">
          <h3 title={document.title}>{document.title}</h3>
          <button
            aria-label={document.isStarred ? "取消文件收藏" : "收藏文件"}
            className={`icon-button star-button${document.isStarred ? " active" : ""}`}
            onClick={() => onToggleStar(document)}
            type="button"
          >
            <Star fill={document.isStarred ? "currentColor" : "none"} size={17} />
          </button>
        </div>
        <p title={document.filepath}>{document.filename}</p>
        <div className="document-meta">
          <span>{formatFileSize(document.fileSize)}</span>
          <span>{document.pageCount ? `${document.pageCount} 页` : "等待首次解析"}</span>
          <span>{formatDate(document.lastOpenedAt)}</span>
        </div>
      </div>
      <div className="document-progress" aria-label={progress ? `阅读进度 ${Math.round(progress)}%` : "阅读进度尚未开始"}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <details className="document-menu" ref={menuRef}>
        <summary aria-label="文件菜单">
          <MoreHorizontal size={18} />
        </summary>
        <div className="menu-popover">
          <Link className="menu-link" to={`/reader/${document.id}`}>打开阅读器</Link>
          <button onClick={() => void documentGateway.openExternal(document.id)} type="button"><ExternalLink size={13} />用系统程序打开</button>
          <button onClick={() => void documentGateway.reveal(document.id)} type="button"><FolderSearch size={13} />在文件管理器中显示</button>
          <button onClick={() => void navigator.clipboard.writeText(document.filepath)} type="button"><Copy size={13} />复制文件路径</button>
          <button
            onClick={() => {
              const title = window.prompt("修改显示标题", document.title)?.trim();
              if (title && title !== document.title) onRename(document, title);
            }}
            type="button"
          ><Pencil size={13} />修改显示标题</button>
          <button
            onClick={() => {
              if (window.confirm("从资料库移除这条记录？关联的阅读进度和收藏也会移除；原 PDF 文件不会被删除。")) {
                onRemove(document);
              }
            }}
            type="button"
          >
            从资料库移除
          </button>
        </div>
      </details>
    </article>
  );
}
