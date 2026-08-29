import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, settingsGateway, type AppSettings } from "./settingsGateway";

describe("settings gateway browser fallback", () => {
  beforeEach(() => window.localStorage.clear());

  it("uses safe defaults when no previous settings exist", async () => {
    await expect(settingsGateway.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it("persists and restores all appearance settings", async () => {
    const settings: AppSettings = {
      theme: "dark",
      uiScale: 150,
      fontScale: 130,
      accent: "pink",
    };

    await settingsGateway.save(settings);

    await expect(settingsGateway.get()).resolves.toEqual(settings);
  });
});
