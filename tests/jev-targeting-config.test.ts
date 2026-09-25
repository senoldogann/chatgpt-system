import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];

  const restore = (): void => {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  return run().finally(restore);
}

describe("Jev semantic targeting configuration", () => {
  it("is disabled by default with no API key", async () => {
    await withEnv({ CHATGPT_SYSTEM_ENABLE_JEV_TARGETING: undefined, TYPESAFE_API_KEY: undefined }, async () => {
      const config = await loadConfig({ roots: [process.cwd()] });
      expect(config.jevTargeting).toEqual({ enabled: false, apiKey: null });
    });
  });

  it("requires Computer Runtime to be explicitly enabled", async () => {
    await withEnv({ TYPESAFE_API_KEY: "test-key" }, async () => {
      await expect(loadConfig({
        roots: [process.cwd()],
        jevTargetingEnabled: true,
      })).rejects.toThrow(/requires Computer Runtime/i);

      const config = await loadConfig({
        roots: [process.cwd()],
        computerUseEnabled: true,
        jevTargetingEnabled: true,
      });
      expect(config.jevTargeting).toEqual({ enabled: true, apiKey: "test-key" });
    });
  });

  it("requires TYPESAFE_API_KEY when enabled", async () => {
    await withEnv({ TYPESAFE_API_KEY: undefined }, async () => {
      await expect(loadConfig({
        roots: [process.cwd()],
        computerUseEnabled: true,
        jevTargetingEnabled: true,
      })).rejects.toThrow(/TYPESAFE_API_KEY/);
    });
  });

  it("accepts typesafeApiKey via config overrides", async () => {
    await withEnv({ TYPESAFE_API_KEY: undefined }, async () => {
      const config = await loadConfig({
        roots: [process.cwd()],
        computerUseEnabled: true,
        jevTargetingEnabled: true,
        typesafeApiKey: "override-key",
      });
      expect(config.jevTargeting).toEqual({ enabled: true, apiKey: "override-key" });
    });
  });
});
