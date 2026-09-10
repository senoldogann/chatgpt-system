import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("computer use configuration", () => {
  it("is disabled by default with fixed bounded runtime defaults", async () => {
    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.computerUse).toEqual({
      enabled: false,
      hostBundlePath: path.join(homedir(), ".chatgpt-system", "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
    });
  });

  it("enables computer use only through an explicit trusted startup override", async () => {
    const config = await loadConfig({ roots: [process.cwd()], computerUseEnabled: true });
    expect(config.computerUse.enabled).toBe(true);
  });
});
