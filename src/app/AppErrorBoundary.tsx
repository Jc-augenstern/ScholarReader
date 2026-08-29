import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportFrontendError } from "../platform/tauri/diagnostics";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ScholarReader UI error", error, info.componentStack);
    void reportFrontendError(error, "react.error-boundary", info.componentStack ?? "");
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal-error">
        <span>ScholarReader</span>
        <h1>界面遇到问题</h1>
        <p>{this.state.error.message || "发生了未预期的界面错误。你的 PDF 与本地数据库没有被修改。"}</p>
        <button className="primary-button" onClick={() => window.location.reload()} type="button">重新加载应用</button>
      </main>
    );
  }
}
