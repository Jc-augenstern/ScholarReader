import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./AppShell";
import { FavoritesPage } from "../pages/FavoritesPage";
import { HomePage } from "../pages/HomePage";
import { LibraryPage } from "../pages/LibraryPage";
import { TagsPage } from "../pages/TagsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { RecentPage } from "../pages/RecentPage";
import { reportFrontendEvent } from "../platform/tauri/diagnostics";

const ReaderPage = lazy(() =>
  import("../pages/ReaderPage").then((module) => ({ default: module.ReaderPage })),
);

function RouteDiagnostics() {
  const location = useLocation();
  useEffect(() => {
    void reportFrontendEvent("route_changed", { route: location.pathname });
  }, [location.pathname]);
  return null;
}

export function AppRouter() {
  return (
    <><RouteDiagnostics /><Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route
          path="reader/:documentId"
          element={
            <Suspense fallback={<div className="reader-loading"><span className="spinner dark" />正在加载 PDF 引擎…</div>}>
              <ReaderPage />
            </Suspense>
          }
        />
        <Route path="favorites" element={<FavoritesPage />} />
        <Route path="recent" element={<RecentPage />} />
        <Route path="tags" element={<TagsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Route>
    </Routes></>
  );
}
