import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  OWNER_SHELL_MAX_SCRIPT_BYTES,
  OWNER_TERMINAL_MAX_INPUT_BYTES,
  OWNER_TERMINAL_MAX_OUTPUT_BYTES,
  OWNER_TERMINAL_MAX_SESSIONS,
} from "../src/config.js";

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
  it("is disabled by default even when Personal Admin is enabled", async () => {
    const root = await tempRoot();
    const config = await loadConfig({ roots: [root], personalAdminEnabled: true });

    expect(config.ownerRuntime.enabled).toBe(false);
    expect(config.ownerRuntime.maxScriptBytes).toBe(OWNER_SHELL_MAX_SCRIPT_BYTES);
  });

  it("enables only with Personal Admin and resolves a trusted absolute shell path", async () => {
    const root = await tempRoot();
    const config = await loadConfig({
      roots: [root],
      personalAdminEnabled: true,
      ownerRuntimeEnabled: true,
      ownerShellPath: "/bin/sh",
    });

    expect(config.ownerRuntime).toEqual({
      enabled: true,
      shellPath: expect.stringMatching(/^\//),
      maxScriptBytes: OWNER_SHELL_MAX_SCRIPT_BYTES,
      maxTerminalSessions: OWNER_TERMINAL_MAX_SESSIONS,
      maxTerminalOutputBytes: OWNER_TERMINAL_MAX_OUTPUT_BYTES,
      maxTerminalInputBytes: OWNER_TERMINAL_MAX_INPUT_BYTES,
    });
  });

  it("rejects Owner Runtime without Personal Admin", async () => {
    const root = await tempRoot();

    await expect(loadConfig({
      roots: [root],
      ownerRuntimeEnabled: true,
      ownerShellPath: "/bin/sh",
    })).rejects.toThrow(/personal admin/i);
  });

  it("rejects a relative trusted shell path", async () => {
    const root = await tempRoot();

    await expect(loadConfig({
      roots: [root],
      personalAdminEnabled: true,
      ownerRuntimeEnabled: true,
      ownerShellPath: "bin/sh",
    })).rejects.toThrow(/absolute/i);
  });
});
