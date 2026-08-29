import "./polyfills/mapUpsert";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installGlobalErrorDiagnostics } from "./platform/tauri/diagnostics";

installGlobalErrorDiagnostics();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
