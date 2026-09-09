import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { parseCliCommand } from "../src/cli-command.js";
import { loadConfig, resolveBrowserUserDataDir } from "../src/config.js";

const browserEnvKeys = [
  "CHATGPT_SYSTEM_ENABLE_BROWSER",
  "CHATGPT_SYSTEM_BROWSER_HEADLESS",
  "CHATGPT_SYSTEM_BROWSER_TIMEOUT_MS",
  "CHATGPT_SYSTEM_BROWSER_USER_DATA_DIR",
] as const;

describe("browser runtime configuration", () => {
  let root: string;
  let previousEnv: Partial<Record<(typeof browserEnvKeys)[number], string | undefined>>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-browser-config-"));
    previousEnv = {};
    for (const key of browserEnvKeys) {
      previousEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of browserEnvKeys) {
      const value = previousEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("keeps browser automation disabled with a dedicated profile by default", async () => {
    const config = await loadConfig({ roots: [root] });

    expect(config.browser).toEqual({
      enabled: false,
      headless: false,
      timeoutMs: 10_000,
      userDataDir: path.join(homedir(), ".chatgpt-system", "browser-profile"),
    });
  });

  it("normalizes explicit browser profile paths without accepting relative paths", () => {
    expect(resolveBrowserUserDataDir("~/automation", "/Users/example")).toBe("/Users/example/automation");
    expect(resolveBrowserUserDataDir("/tmp/browser-profile", "/Users/example")).toBe("/tmp/browser-profile");
    expect(() => resolveBrowserUserDataDir("relative/profile", "/Users/example")).toThrow(/absolute/i);
  });

  it("parses explicit browser startup flags", () => {
    expect(parseCliCommand([
      "stdio",
      "--enable-browser",
      "--browser-headless",
      "--browser-timeout-ms", "15000",
      "--browser-user-data-dir", "~/browser-test",
    ])).toEqual({
      kind: "server",
      mode: "stdio",
      help: false,
      overrides: {
        browserEnabled: true,
        browserHeadless: true,
        browserTimeoutMs: 15_000,
        browserUserDataDir: "~/browser-test",
      },
    });
  });

  it("rejects invalid browser timeout values at CLI parse time", () => {
    expect(() => parseCliCommand(["stdio", "--browser-timeout-ms", "0"])).toThrow(/positive/i);
    expect(() => parseCliCommand(["stdio", "--browser-timeout-ms", "nope"])).toThrow(/positive/i);
  });
});
