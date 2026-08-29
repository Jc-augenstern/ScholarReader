import { create } from "zustand";
import {
  DEFAULT_APP_SETTINGS,
  settingsGateway,
  type AccentPreference,
  type AppSettings,
  type ThemePreference,
} from "../platform/tauri/settingsGateway";

type SettingsState = AppSettings & {
  loaded: boolean;
  load: () => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setUiScale: (uiScale: number) => Promise<void>;
  setFontScale: (fontScale: number) => Promise<void>;
  setAccent: (accent: AccentPreference) => Promise<void>;
  resetDisplayScale: () => Promise<void>;
};

function applyAppearance(settings: AppSettings) {
  const root = document.documentElement;
  if (settings.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.uiScale = String(settings.uiScale);
  root.dataset.fontScale = String(settings.fontScale);
  root.style.setProperty("--ui-scale", String(settings.uiScale / 100));
  root.style.setProperty("--ui-scale-inverse", String(100 / settings.uiScale));
  root.style.setProperty("--font-scale", String(settings.fontScale / 100));
}

function currentSettings(state: SettingsState): AppSettings {
  return {
    theme: state.theme,
    uiScale: state.uiScale,
    fontScale: state.fontScale,
    accent: state.accent,
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_APP_SETTINGS,
  loaded: false,
  async load() {
    const settings = await settingsGateway.get();
    applyAppearance(settings);
    set({ ...settings, loaded: true });
  },
  async setTheme(theme) {
    await saveUpdate({ theme });
  },
  async setUiScale(uiScale) {
    await saveUpdate({ uiScale });
  },
  async setFontScale(fontScale) {
    await saveUpdate({ fontScale });
  },
  async setAccent(accent) {
    await saveUpdate({ accent });
  },
  async resetDisplayScale() {
    await saveUpdate({ uiScale: 100, fontScale: 100 });
  },
}));

async function saveUpdate(partial: Partial<AppSettings>): Promise<void> {
  const previous = currentSettings(useSettingsStore.getState());
  const next = { ...previous, ...partial };
  applyAppearance(next);
  useSettingsStore.setState(next);
  try {
    const saved = await settingsGateway.save(next);
    applyAppearance(saved);
    useSettingsStore.setState(saved);
  } catch (reason) {
    const restored = await settingsGateway.get().catch(() => previous);
    applyAppearance(restored);
    useSettingsStore.setState(restored);
    throw reason;
  }
}
