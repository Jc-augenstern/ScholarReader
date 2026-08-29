import { ArrowRight, BookOpen, Clock3, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLibraryStore } from "../stores/libraryStore";
import { formatDate } from "../utils/format";
import type { Favorite } from "../core/models/favorite";
import { favoriteGateway } from "../platform/tauri/favoriteGateway";

export function HomePage() {
  const documents = useLibraryStore((state) => state.documents);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  useEffect(() => { void favoriteGateway.list().then((items) => setFavorites(items.slice(0, 3))).catch(() => setFavorites([])); }, []);
  const recent = useMemo(() => documents.filter((item) => item.lastOpenedAt).slice(0, 3), [documents]);
  const continueReading = recent[0];

  return (
    <div className="page home-page">
      <section className="welcome-panel">
        <div>
          <span className="eyebrow">欢迎回来</span>
          <h1>让重要原文随时找得回来。</h1>
          <p>阅读、收藏和定位都保存在本地；AI 只是按需启用的增强能力。</p>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <BookOpen size={48} strokeWidth={1.25} />
        </div>
      </section>

      <section className="metrics-grid" aria-label="资料库概览">
        <div className="metric-card">
          <span><BookOpen size={17} />PDF 文档</span>
          <strong>{documents.length}</strong>
        </div>
        <div className="metric-card">
          <span><Star size={17} />原文收藏</span>
          <strong>{favorites.length}</strong>
        </div>
        <div className="metric-card">
          <span><Clock3 size={17} />最近阅读</span>
          <strong>{documents.filter((document) => document.lastOpenedAt).length}</strong>
        </div>
      </section>

      <section className="section-block">
        <div className="section-header">
          <div><span className="eyebrow">阅读</span><h2>{continueReading ? "继续阅读" : "最近添加"}</h2></div>
          <Link className="text-link" to={continueReading ? "/recent" : "/library"}>查看全部 <ArrowRight size={15} /></Link>
        </div>
        {recent.length ? (
          <div className="recent-list">
            {recent.map((document) => (
              <div className="recent-row" key={document.id}>
                <div className="mini-pdf">PDF</div>
                <div>
                  <strong>{document.title}</strong>
                  <span>{formatDate(document.lastOpenedAt ?? document.createdAt)} · {document.readingPage ?? 1} / {document.pageCount ?? "?"} 页</span>
                </div>
                <Link className="status-pill ready continue-link" to={`/reader/${document.id}`}>继续</Link>
              </div>
            ))}
          </div>
        ) : (
          <div className="compact-empty">添加 PDF 后，最近资料会显示在这里。</div>
        )}
      </section>
      <section className="section-block home-favorites">
        <div className="section-header"><div><span className="eyebrow">摘录</span><h2>最近收藏</h2></div><Link className="text-link" to="/favorites">查看全部 <ArrowRight size={15} /></Link></div>
        {favorites.length ? <div className="home-favorite-list">{favorites.map((favorite) => (
          <Link key={favorite.id} to={`/reader/${favorite.documentId}?page=${favorite.pageNumber}&favorite=${favorite.id}`}>
            <blockquote>“{favorite.selectedText}”</blockquote><span>{favorite.documentTitle} · 第 {favorite.pageNumber} 页</span>
          </Link>
        ))}</div> : <div className="compact-empty">收藏重要原文后，会显示在这里。</div>}
      </section>
    </div>
  );
}
