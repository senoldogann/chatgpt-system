import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyOwnerWorkstationPreset,
  HOSTED_RESPONSE_BUDGET_MS,
  loadConfig,
  OWNER_SHELL_MAX_SCRIPT_BYTES,
  OWNER_WORKSTATION_COMMAND_TIMEOUT_MS,
  OWNER_TERMINAL_MAX_INPUT_BYTES,
  OWNER_TERMINAL_MAX_OUTPUT_BYTES,
  OWNER_TERMINAL_MAX_SESSIONS,
} from "../src/core/config.js";

const cleanups: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-runtime-config-"));
  cleanups.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("Owner Runtime configuration", () => {
  it("expands the Owner Workstation preset without mutating caller overrides", () => {
    const input = { roots: ["/tmp/project"], ownerWorkstationEnabled: true };
    const result = applyOwnerWorkstationPreset(input);

    expect(input).toEqual({ roots: ["/tmp/project"], ownerWorkstationEnabled: true });
    expect(result).toEqual({
      roots: ["/tmp/project"],
      ownerWorkstationEnabled: true,
      ownerRuntimeEnabled: true,
      terminalEnabled: true,
      projectExecEnabled: true,
      computerUseEnabled: true,
      fullHostJsEnabled: true,
      commandTimeoutMs: OWNER_WORKSTATION_COMMAND_TIMEOUT_MS,
    });
  });

  it("is disabled by default", async () => {
    const root = await tempRoot();
    const config = await loadConfig({ roots: [root] });

    expect(config.ownerRuntime.enabled).toBe(false);
    expect(config.ownerRuntime.maxScriptBytes).toBe(OWNER_SHELL_MAX_SCRIPT_BYTES);
  });

  it("expands Owner Workstation to the approved local capabilities while defaults stay off", async () => {
    const root = await tempRoot();
    const defaults = await loadConfig({ roots: [root] });
    expect(defaults.ownerRuntime.enabled).toBe(false);
    expect(defaults.terminal.enabled).toBe(false);
    expect(defaults.projectExec.enabled).toBe(false);
    expect(defaults.computerUse.enabled).toBe(false);
    expect(defaults.computerUse.fullHostJsEnabled).toBe(false);

    const configured = await loadConfig({ roots: [root], ownerWorkstationEnabled: true });
    expect(configured.ownerRuntime.enabled).toBe(true);
    expect(configured.terminal.enabled).toBe(true);
    expect(configured.projectExec.enabled).toBe(true);
    expect(configured.computerUse.enabled).toBe(true);
    expect(configured.computerUse.fullHostJsEnabled).toBe(true);
    expect(configured.browser.enabled).toBe(false);
    expect(defaults.limits.commandTimeoutMs).toBe(60_000);
    expect(configured.limits.commandTimeoutMs).toBe(OWNER_WORKSTATION_COMMAND_TIMEOUT_MS);
  });

  it("enables explicitly and resolves a trusted absolute shell path", async () => {
    const root = await tempRoot();
    const config = await loadConfig({
      roots: [root],
      ownerRuntimeEnabled: true,
      ownerShellPath: "/bin/sh",
    });

    expect(config.ownerRuntime).toEqual({
      enabled: true,
      shellPath: expect.stringMatching(/^\//),
      maxScriptBytes: OWNER_SHELL_MAX_SCRIPT_BYTES,
      maxTimeoutMs: HOSTED_RESPONSE_BUDGET_MS,
      maxTerminalSessions: OWNER_TERMINAL_MAX_SESSIONS,
      maxTerminalOutputBytes: OWNER_TERMINAL_MAX_OUTPUT_BYTES,
      maxTerminalInputBytes: OWNER_TERMINAL_MAX_INPUT_BYTES,
    });
  });

  it("bounds the owner shell budget with the hosted response budget override", async () => {
    const root = await tempRoot();
    process.env.CHATGPT_SYSTEM_HOSTED_RESPONSE_BUDGET_MS = "45000";
    try {
      const config = await loadConfig({
        roots: [root],
        ownerRuntimeEnabled: true,
        ownerShellPath: "/bin/sh",
      });
      expect(config.ownerRuntime.maxTimeoutMs).toBe(45_000);
    } finally {
      delete process.env.CHATGPT_SYSTEM_HOSTED_RESPONSE_BUDGET_MS;
    }
  });

  it("enables Owner Runtime without any Personal Admin coupling", async () => {
    const root = await tempRoot();

    // Serbest mod: Owner Runtime yalnızca startup bayrağına bağlıdır.
    const config = await loadConfig({
      roots: [root],
      ownerRuntimeEnabled: true,
      ownerShellPath: "/bin/sh",
    });
    expect(config.ownerRuntime.enabled).toBe(true);
  });

  it("rejects a relative trusted shell path", async () => {
    const root = await tempRoot();

    await expect(loadConfig({
      roots: [root],
      ownerRuntimeEnabled: true,
      ownerShellPath: "bin/sh",
    })).rejects.toThrow(/absolute/i);
  });
});
