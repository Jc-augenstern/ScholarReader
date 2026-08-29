import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  settingsGateway,
  type AppSettings,
} from "../platform/tauri/settingsGateway";
import { useSettingsStore } from "./settingsStore";

const customized: AppSettings = {
  theme: "dark",
  uiScale: 125,
  fontScale: 120,
  accent: "purple",
};

describe("display settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("style");
    useSettingsStore.setState({ ...DEFAULT_APP_SETTINGS, loaded: false });
  });

  it("restores UI scale, font scale, accent and theme after loading", async () => {
    vi.spyOn(settingsGateway, "get").mockResolvedValue(customized);

    await useSettingsStore.getState().load();

    expect(useSettingsStore.getState()).toMatchObject({ ...customized, loaded: true });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("purple");
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.25");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.2");
  });

  it("previews and saves UI, font and accent changes", async () => {
    const save = vi.spyOn(settingsGateway, "save").mockImplementation(async (settings) => settings);

    await useSettingsStore.getState().setUiScale(150);
    await useSettingsStore.getState().setFontScale(130);
    await useSettingsStore.getState().setAccent("blue");

    expect(useSettingsStore.getState()).toMatchObject({ uiScale: 150, fontScale: 130, accent: "blue" });
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.5");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.3");
    expect(document.documentElement.dataset.accent).toBe("blue");
    expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_APP_SETTINGS, uiScale: 150, fontScale: 130, accent: "blue" });
  });

  it("resets only UI and font scale", async () => {
    useSettingsStore.setState({ ...customized, loaded: true });
    vi.spyOn(settingsGateway, "save").mockImplementation(async (settings) => settings);

    await useSettingsStore.getState().resetDisplayScale();

    expect(useSettingsStore.getState()).toMatchObject({
      theme: "dark",
      accent: "purple",
      uiScale: 100,
      fontScale: 100,
    });
    expect(settingsGateway.save).toHaveBeenCalledWith({ ...customized, uiScale: 100, fontScale: 100 });
  });
});
