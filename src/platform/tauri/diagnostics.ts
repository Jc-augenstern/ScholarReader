import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./runtime";
import type { DiagnosticsSnapshot } from "../../core/models/ai";

export type FrontendErrorReport = {
  timestamp: string;
  source: string;
  message: string;
  stack: string;
  componentStack: string;
  route: string;
  appVersion: string;
};

function describeError(reason: unknown): { message: string; stack: string } {
  if (reason instanceof Error) {
    return { message: reason.message || reason.name, stack: reason.stack ?? "" };
  }
  if (typeof reason === "object" && reason && "message" in reason) {
    const message = String(reason.message);
    const stack = "stack" in reason ? String(reason.stack ?? "") : "";
    return { message, stack };
  }
  return { message: String(reason), stack: "" };
}

async function resolveAppVersion(): Promise<string> {
  if (!isDesktopRuntime()) return "browser-preview";
  try {
    return await getVersion();
  } catch {
    return "unknown";
  }
}

export async function reportFrontendError(
  reason: unknown,
  source: string,
  componentStack = "",
): Promise<FrontendErrorReport> {
  const { message, stack } = describeError(reason);
  const report: FrontendErrorReport = {
    timestamp: new Date().toISOString(),
    source,
    message,
    stack,
    componentStack,
    route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    appVersion: await resolveAppVersion(),
  };

  if (isDesktopRuntime()) {
    try {
      await invoke<string>("record_frontend_error", { report });
    } catch (loggingError) {
      console.error("ScholarReader could not persist the frontend error report", loggingError);
    }
  }
  return report;
}

export async function reportFrontendEvent(
  name: string,
  details: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!isDesktopRuntime()) return;
  try {
    await invoke<void>("record_frontend_event", {
      event: {
        name,
        route: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        details,
      },
    });
  } catch (loggingError) {
    console.error("ScholarReader could not persist the frontend event", loggingError);
  }
}

export const diagnosticsGateway = {
  getSnapshot(): Promise<DiagnosticsSnapshot> {
    if (!isDesktopRuntime()) return Promise.resolve({
      version: "browser-preview",
      platform: navigator.platform,
      provider: "disabled",
      providerStatus: "disabled",
      model: "—",
      modelInstalled: false,
      runtimeInstalled: false,
      runtimeRunning: false,
      databaseSchema: 0,
      lastAiError: null,
      logDirectory: "—",
    });
    return invoke<DiagnosticsSnapshot>("get_diagnostics");
  },
  openLogs(): Promise<void> {
    if (!isDesktopRuntime()) return Promise.resolve();
    return invoke<void>("open_diagnostics_logs");
  },
  exportReport(): Promise<string> {
    if (!isDesktopRuntime()) return Promise.resolve("browser-preview");
    return invoke<string>("export_diagnostics_report");
  },
};

let globalDiagnosticsInstalled = false;

export function installGlobalErrorDiagnostics(): void {
  if (globalDiagnosticsInstalled) return;
  globalDiagnosticsInstalled = true;
  window.addEventListener("error", (event) => {
    void reportFrontendError(event.error ?? event.message, "window.error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    void reportFrontendError(event.reason, "window.unhandledrejection");
  });
}
