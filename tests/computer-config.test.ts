import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("computer use configuration", () => {
  it("is disabled by default with fixed bounded runtime defaults", async () => {
    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.computerUse).toEqual({
      enabled: false,
      fullHostJsEnabled: false,
      hostBundlePath: path.join(homedir(), ".chatgpt-system", "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
      maxAutomaticRetriesPerAction: 2,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    });
  });

  it("enables computer use only through an explicit trusted startup override", async () => {
    const config = await loadConfig({ roots: [process.cwd()], computerUseEnabled: true });
    expect(config.computerUse.enabled).toBe(true);
  });

  it("requires computer use when full-host JavaScript is enabled", async () => {
    await expect(loadConfig({
      roots: [process.cwd()],
      fullHostJsEnabled: true,
    })).rejects.toThrow(/requires Computer Runtime/i);

    const config = await loadConfig({
      roots: [process.cwd()],
      computerUseEnabled: true,
      fullHostJsEnabled: true,
    });
    expect(config.computerUse.fullHostJsEnabled).toBe(true);
  });

  it("allows environment configuration to lower but not raise full-host JavaScript hard limits", async () => {
    const previous = {
      source: process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES,
      runtime: process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS,
      output: process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES,
    };
    try {
      process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES = "131072";
      process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS = "15000";
      process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES = "524288";
      const lowered = await loadConfig({ roots: [process.cwd()] });
      expect(lowered.computerUse).toMatchObject({
        maxJsSourceBytes: 131_072,
        maxJsRuntimeMs: 15_000,
        maxJsOutputBytes: 524_288,
      });

      process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES = "262145";
      await expect(loadConfig({ roots: [process.cwd()] })).rejects.toThrow();
    } finally {
      if (previous.source === undefined) delete process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES;
      else process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES = previous.source;
      if (previous.runtime === undefined) delete process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS;
      else process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS = previous.runtime;
      if (previous.output === undefined) delete process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES;
      else process.env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES = previous.output;
    }
  });
});
