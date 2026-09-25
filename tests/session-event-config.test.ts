import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";

const original = process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS;
afterEach(() => {
  if (original === undefined) delete process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS;
  else process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS = original;
});

describe("session metadata configuration", () => {
  it("is disabled by default and cannot implicitly enable from unrelated presets", async () => {
    delete process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS;
    const config = await loadConfig({ roots: [process.cwd()] });
    expect(config.sessionEvents).toEqual({ enabled: false });
    const workstation = await loadConfig({ roots: [process.cwd()], ownerWorkstationEnabled: true });
    expect(workstation.sessionEvents).toEqual({ enabled: false });
  });

  it("allows explicit opt-in and an explicit false override", async () => {
    process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS = "true";
    const enabled = await loadConfig({ roots: [process.cwd()] });
    expect(enabled.sessionEvents).toEqual({ enabled: true });
    const disabled = await loadConfig({ roots: [process.cwd()], sessionEventsEnabled: false });
    expect(disabled.sessionEvents).toEqual({ enabled: false });
  });

  it("rejects malformed feature flag rather than silently turning it on", async () => {
    process.env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS = "maybe";
    await expect(loadConfig({ roots: [process.cwd()] })).rejects.toThrow();
  });
});
