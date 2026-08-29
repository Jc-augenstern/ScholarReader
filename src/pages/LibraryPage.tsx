import { FolderPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { DocumentCard } from "../components/DocumentCard";
import { EmptyLibrary } from "../components/EmptyLibrary";
import { useLibraryStore } from "../stores/libraryStore";

export function LibraryPage() {
  const [query, setQuery] = useState("");
  const documents = useLibraryStore((state) => state.documents);
  const loading = useLibraryStore((state) => state.loading);
  const importing = useLibraryStore((state) => state.importing);
  const chooseAndImport = useLibraryStore((state) => state.chooseAndImport);
  const removeDocument = useLibraryStore((state) => state.removeDocument);
  const renameDocument = useLibraryStore((state) => state.renameDocument);
  const toggleStar = useLibraryStore((state) => state.toggleStar);
  const chooseAndImportFolder = useLibraryStore((state) => state.chooseAndImportFolder);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return documents;
    return documents.filter((document) =>
      [document.title, document.filename, document.filepath]
        .some((value) => value.toLocaleLowerCase().includes(normalized)),
    );
  }, [documents, query]);

  return (
    <div className="page library-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">本地 PDF</span>
          <h1>文件库</h1>
          <p>管理论文、教材和讲义，文件始终保留在原始位置。</p>
        </div>
      </div>

      {documents.length ? (
        <>
          <div className="library-toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="搜索 PDF"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、文件名或路径"
                type="search"
                value={query}
              />
            </label>
            <button className="secondary-button" disabled={importing} onClick={() => void chooseAndImportFolder()} type="button">
              <FolderPlus size={16} /> 导入文件夹
            </button>
          </div>
          <div className="list-summary">
            <span>{filtered.length} 个文档</span>
            {query && <span>搜索“{query}”</span>}
          </div>
          <div className="document-list">
            {filtered.map((document) => (
              <DocumentCard
                document={document}
                key={document.id}
                onRemove={(item) => void removeDocument(item.id)}
                onRename={(item, title) => void renameDocument(item, title)}
                onToggleStar={(item) => void toggleStar(item)}
              />
            ))}
            {!filtered.length && <div className="compact-empty">没有匹配的 PDF。</div>}
          </div>
        </>
      ) : loading ? (
        <div className="loading-panel"><span className="spinner dark" />正在读取资料库…</div>
      ) : (
        <EmptyLibrary importing={importing} onAdd={() => void chooseAndImport()} />
      )}
    </div>
  );
}
