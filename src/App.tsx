import { useEffect } from "react";
import { HashRouter } from "react-router-dom";
import { AppRouter } from "./app/AppRouter";
import { useLibraryStore } from "./stores/libraryStore";
import "./App.css";
import { AppErrorBoundary } from "./app/AppErrorBoundary";

function App() {
  const loadDocuments = useLibraryStore((state) => state.loadDocuments);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  return (
    <AppErrorBoundary>
      <HashRouter>
        <AppRouter />
      </HashRouter>
    </AppErrorBoundary>
  );
}

export default App;
