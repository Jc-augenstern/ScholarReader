import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpenText,
  Clock3,
  FileText,
  FolderOpen,
  Home,
  LibraryBig,
  Plus,
  Settings,
  Star,
  Tags,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useLibraryStore } from "../stores/libraryStore";
import type { DatabaseStatus } from "../core/models/document";
import { isDesktopRuntime } from "../platform/tauri/runtime";
import { AIInspector } from "../features/ai/AIInspector";
import { AIOnboarding } from "../features/ai/AIOnboarding";
import { useAiStore } from "../stores/aiStore";
import { useSettingsStore } from "../stores/settingsStore";

const navigation = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/library", label: "文件库", icon: LibraryBig },
  { to: "/favorites", label: "收藏", icon: Star },
  { to: "/recent", label: "最近阅读", icon: Clock3 },
  { to: "/tags", label: "标签", icon: Tags },
];

const titles: Record<string, string> = {
  "/": "学习概览",
  "/library": "PDF 文件库",
  "/favorites": "收藏库",
  "/recent": "最近阅读",
  "/tags": "标签",
  "/settings": "设置",
};

export function AppShell() {
  const location = useLocation();
  const chooseAndImport = useLibraryStore((state) => state.chooseAndImport);
  const importing = useLibraryStore((state) => state.importing);
  const documents = useLibraryStore((state) => state.documents);
  const notice = useLibraryStore((state) => state.notice);
  const error = useLibraryStore((state) => state.error);
  const clearFeedback = useLibraryStore((state) => state.clearFeedback);
  const [database, setDatabase] = useState<DatabaseStatus | null>(null);
  const loadAiSettings = useAiStore((state) => state.loadSettings);
  const loadAppSettings = useSettingsStore((state) => state.load);

  useEffect(() => {
    void loadAiSettings();
    void loadAppSettings();
    if (!isDesktopRuntime()) return;
    void invoke<DatabaseStatus>("database_status")
      .then(setDatabase)
      .catch(() => setDatabase(null));
  }, [loadAiSettings, loadAppSettings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === "o") {
        event.preventDefault();
        void chooseAndImport();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooseAndImport]);

  return (
    <div className="app-shell">
      <AIOnboarding />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BookOpenText size={22} strokeWidth={1.8} />
          </div>
          <div>
            <strong>ScholarReader</strong>
            <span>本地优先的 PDF 学习阅读器</span>
          </div>
        </div>

        <div className="topbar-title">
          {location.pathname.startsWith("/reader/") ? "PDF 阅读器" : titles[location.pathname] ?? "ScholarReader"}
        </div>

        <button
          className="primary-button"
          disabled={importing}
          onClick={() => void chooseAndImport()}
          type="button"
        >
          {importing ? <span className="spinner" /> : <Plus size={17} />}
          {importing ? "正在导入" : "添加 PDF"}
        </button>
      </header>

      <aside className="sidebar">
        <nav aria-label="主要导航" className="nav-list">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              end={end}
              key={to}
              to={to}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {to === "/library" && documents.length > 0 ? (
                <span className="nav-count">{documents.length}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-section">
          <span className="sidebar-label">工作区</span>
          <div className="workspace-card">
            <FolderOpen size={18} />
            <div>
              <strong>本地资料库</strong>
              <span>PDF 保留在原位置</span>
            </div>
          </div>
        </div>

        <NavLink
          className={({ isActive }) => `nav-item settings-link${isActive ? " active" : ""}`}
          to="/settings"
        >
          <Settings size={18} strokeWidth={1.8} />
          <span>设置</span>
        </NavLink>
      </aside>

      <main className="main-content">
        {(notice || error) && (
          <button
            className={`feedback-banner${error ? " error" : ""}`}
            onClick={clearFeedback}
            type="button"
          >
            {error ?? notice}
          </button>
        )}
        <Outlet />
      </main>

      <aside className="inspector">
        <AIInspector />

        <section className="inspector-card">
          <div className="inspector-heading">
            <FileText size={17} />
            <span>本地引擎</span>
          </div>
          <dl className="status-list">
            <div>
              <dt>SQLite</dt>
              <dd className={database?.ready ? "status-good" : "status-muted"}>
                {database?.ready ? "已连接" : isDesktopRuntime() ? "等待桌面后端" : "浏览器预览"}
              </dd>
            </div>
            <div>
              <dt>Schema</dt>
              <dd>{database ? `v${database.schemaVersion}` : "—"}</dd>
            </div>
            <div>
              <dt>PDF.js</dt>
              <dd>已配置</dd>
            </div>
          </dl>
        </section>

        <section className="inspector-card privacy-card">
          <div className="inspector-heading">
            <LibraryBig size={17} />
            <span>数据策略</span>
          </div>
          <p>资料库只保存文件路径与学习数据，不复制或修改原 PDF。</p>
        </section>
      </aside>

      <footer className="statusbar">
        <span className="status-dot" />
        <span>{database?.ready ? "本地数据库已就绪" : isDesktopRuntime() ? "正在连接桌面后端" : "浏览器预览模式"}</span>
        <span className="statusbar-spacer" />
        <span>Core 与 AI 已解耦</span>
      </footer>
    </div>
  );
}
