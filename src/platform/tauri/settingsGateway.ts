import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "./runtime";

export type ThemePreference = "system" | "light" | "dark";
export type AccentPreference = "green" | "blue" | "cyan" | "purple" | "orange" | "red" | "pink";
export type AppSettings = {
  theme: ThemePreference;
  uiScale: number;
  fontScale: number;
  accent: AccentPreference;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  uiScale: 100,
  fontScale: 100,
  accent: "green",
};

const accents: AccentPreference[] = ["green", "blue", "cyan", "purple", "orange", "red", "pink"];

function localNumber(key: string, fallback: number, allowed: readonly number[]): number {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return allowed.includes(value) ? value : fallback;
}

export const settingsGateway = {
  get(): Promise<AppSettings> {
    if (!isDesktopRuntime()) {
      const value = window.localStorage.getItem("scholar-reader-theme");
      const accent = window.localStorage.getItem("scholar-reader-accent");
      return Promise.resolve({
        theme: value === "light" || value === "dark" ? value : "system",
        uiScale: localNumber("scholar-reader-ui-scale", DEFAULT_APP_SETTINGS.uiScale, [80, 90, 100, 110, 125, 150]),
        fontScale: localNumber("scholar-reader-font-scale", DEFAULT_APP_SETTINGS.fontScale, [90, 100, 110, 120, 130]),
        accent: accents.includes(accent as AccentPreference) ? accent as AccentPreference : DEFAULT_APP_SETTINGS.accent,
      });
    }
    return invoke<AppSettings>("get_app_settings");
  },
  save(input: AppSettings): Promise<AppSettings> {
    if (!isDesktopRuntime()) {
      if (input.theme === "system") window.localStorage.removeItem("scholar-reader-theme");
      else window.localStorage.setItem("scholar-reader-theme", input.theme);
      window.localStorage.setItem("scholar-reader-ui-scale", String(input.uiScale));
      window.localStorage.setItem("scholar-reader-font-scale", String(input.fontScale));
      window.localStorage.setItem("scholar-reader-accent", input.accent);
      return Promise.resolve(input);
    }
    return invoke<AppSettings>("save_app_settings", { input });
  },
};
