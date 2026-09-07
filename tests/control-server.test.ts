import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices } from "../src/server.js";
import { startControlServer, type ControlServerHandle } from "../src/control-server.js";

const cleanups: string[] = [];
const handles: ControlServerHandle[] = [];

async function cleanupHandle(handle: ControlServerHandle): Promise<void> {
  try {
    await handle.close();
  } catch {
    // Best-effort test cleanup only.
  }
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map(cleanupHandle));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    http: { host: "127.0.0.1", port: 4312 },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
  };
  return { base, runtime: createRuntimeServices(config) };
}

async function sendRaw(socketPath: string, payload: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000);
    socket.on("connect", () => socket.end(payload, "utf8"));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("timeout", () => socket.destroy(new Error("timeout")));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function createStaleSocket(socketPath: string): Promise<void> {
  const code = `
    const net = require("node:net");
    const server = net.createServer();
    server.listen(${JSON.stringify(socketPath)}, () => process.stdout.write("ready\\n"));
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "ignore"] });
  await once(child.stdout!, "data");
  child.kill("SIGKILL");
  await once(child, "exit");
  expect((await lstat(socketPath)).isSocket()).toBe(true);
}

describe("local authority control server", () => {
  it("creates a private parent/socket, answers ping, and unlinks on shutdown", async () => {
    const { base, runtime } = await fixture();
    const privateDir = path.join(base, "private");
    await mkdir(privateDir, { mode: 0o777 });
    await chmod(privateDir, 0o777);
    const socketPath = path.join(privateDir, "control.sock");

    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const parentInfo = await lstat(privateDir);
    const socketInfo = await lstat(socketPath);
    expect(parentInfo.mode & 0o777).toBe(0o700);
    expect(socketInfo.isSocket()).toBe(true);
    expect(socketInfo.mode & 0o777).toBe(0o600);

    const response = await sendRaw(socketPath, '{"version":1,"action":"ping"}\n');
    expect(JSON.parse(response)).toEqual({ version: 1, ok: true, pong: true });

    await handle.close();
    handles.splice(handles.indexOf(handle), 1);
    await expect(lstat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects regular files and symlinks at the socket path without deleting them", async () => {
    const { base, runtime } = await fixture();
    const regularPath = path.join(base, "regular.sock");
    await writeFile(regularPath, "do-not-delete", "utf8");

    await expect(startControlServer({ socketPath: regularPath, runtime }))
      .rejects.toMatchObject({ code: "CONTROL_SOCKET_IN_USE" });
    expect(await readFile(regularPath, "utf8")).toBe("do-not-delete");

    const target = path.join(base, "target");
    const linkPath = path.join(base, "link.sock");
    await writeFile(target, "target", "utf8");
    await symlink(target, linkPath);
    await expect(startControlServer({ socketPath: linkPath, runtime }))
      .rejects.toMatchObject({ code: "CONTROL_SOCKET_IN_USE" });
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
  });

  it("rejects a live compatible socket and an existing socket owned by another uid", async () => {
    const { base, runtime } = await fixture();
    const socketPath = path.join(base, "control.sock");
    const first = await startControlServer({ socketPath, runtime });
    handles.push(first);

    await expect(startControlServer({ socketPath, runtime }))
      .rejects.toMatchObject({ code: "CONTROL_SOCKET_IN_USE" });

    const currentUid = process.getuid?.() ?? 0;
    await expect(startControlServer({ socketPath, runtime, currentUid: currentUid + 1 }))
      .rejects.toMatchObject({ code: "CONTROL_SOCKET_IN_USE" });
  });

  it("removes a provably stale socket owned by the current uid before binding", async () => {
    const { base, runtime } = await fixture();
    const socketPath = path.join(base, "control.sock");
    await createStaleSocket(socketPath);

    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);
    const response = await sendRaw(socketPath, '{"version":1,"action":"ping"}\n');
    expect(JSON.parse(response)).toEqual({ version: 1, ok: true, pong: true });
  });

  it("returns a protocol error for malformed and oversized frames", async () => {
    const { base, runtime } = await fixture();
    const socketPath = path.join(base, "control.sock");
    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const malformed = JSON.parse(await sendRaw(socketPath, "not-json\n"));
    expect(malformed).toMatchObject({
      version: 1,
      ok: false,
      error: "CONTROL_PROTOCOL_INVALID",
    });

    const oversized = JSON.parse(await sendRaw(socketPath, `${"x".repeat(70_000)}\n`));
    expect(oversized).toMatchObject({
      version: 1,
      ok: false,
      error: "CONTROL_PROTOCOL_INVALID",
    });
  });
});
