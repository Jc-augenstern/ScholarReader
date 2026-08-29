import { Clock3 } from "lucide-react";
import { DocumentCard } from "../components/DocumentCard";
import { useLibraryStore } from "../stores/libraryStore";

export function RecentPage() {
  const documents = useLibraryStore((state) => state.documents);
  const removeDocument = useLibraryStore((state) => state.removeDocument);
  const renameDocument = useLibraryStore((state) => state.renameDocument);
  const toggleStar = useLibraryStore((state) => state.toggleStar);
  const recent = documents
    .filter((document) => document.lastOpenedAt)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));

  return (
    <div className="page recent-page">
      <div className="page-heading">
        <div><span className="eyebrow">阅读</span><h1>最近阅读</h1><p>继续上次的页码、缩放和页面方向。</p></div>
      </div>
      {recent.length ? (
        <div className="document-list">
          {recent.map((document) => (
            <DocumentCard
              document={document}
              key={document.id}
              onRemove={(item) => void removeDocument(item.id)}
              onRename={(item, title) => void renameDocument(item, title)}
              onToggleStar={(item) => void toggleStar(item)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state small-empty"><div className="empty-illustration"><Clock3 size={30} /></div><h2>还没有阅读记录</h2><p>打开资料库中的 PDF 后，阅读位置会自动保存并显示在这里。</p></div>
      )}
    </div>
  );
}
