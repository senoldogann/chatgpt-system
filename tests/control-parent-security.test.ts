import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { startControlServer } from "../src/control-server.js";
import { createRuntimeServices } from "../src/server.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function runtimeFixture(base: string) {
  const root = path.join(base, "root");
  await mkdir(root);
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node"] },
    computerUse: {
      enabled: false,
      hostBundlePath: "/tmp/ChatGPTSystemComputerRuntime.app",
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 4312 },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
  };
  return createRuntimeServices(config);
}

describe("control socket parent trust", () => {
  it("rejects a symlink parent without chmod-following the target", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-parent-"));
    cleanups.push(base);
    const runtime = await runtimeFixture(base);
    const target = path.join(base, "real-private-dir");
    const alias = path.join(base, "private-link");
    await mkdir(target, { mode: 0o755 });
    await chmod(target, 0o755);
    await symlink(target, alias, "dir");

    await expect(startControlServer({
      socketPath: path.join(alias, "control.sock"),
      runtime,
    })).rejects.toMatchObject({ code: "CONTROL_SOCKET_IN_USE" });

    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect((await lstat(target)).mode & 0o777).toBe(0o755);
  });

  it("rejects a parent that does not match the expected runtime uid", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-parent-"));
    cleanups.push(base);
    const runtime = await runtimeFixture(base);
    const parent = path.join(base, "private");
    await mkdir(parent, { mode: 0o700 });
    const actualUid = (await lstat(parent)).uid;

    await expect(startControlServer({
      socketPath: path.join(parent, "control.sock"),
      runtime,
      currentUid: actualUid + 1,
    })).rejects.toMatchObject({ code: "CONTROL_SOCKET_IN_USE" });
  });
});
