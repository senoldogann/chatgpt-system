import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthorityApprovalProfile } from "../src/authority-request-manager.js";
import type { AppConfig } from "../src/config.js";
import type {
  LocalAuthorityBroker,
  LocalAuthorityBrokerResult,
  LocalAuthorityOutcome,
} from "../src/local-authority-broker.js";
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

class ImmediateBroker implements LocalAuthorityBroker {
  readonly seen: Array<{ requestId: string; profile: AuthorityApprovalProfile }> = [];

  constructor(private readonly outcome: LocalAuthorityOutcome = "authenticated") {}

  async request(input: { requestId: string; profile: AuthorityApprovalProfile }): Promise<LocalAuthorityBrokerResult> {
    this.seen.push(input);
    return {
      requestId: input.requestId,
      profile: input.profile,
      approved: this.outcome === "authenticated",
      outcome: this.outcome,
    };
  }
}

class DeferredBroker implements LocalAuthorityBroker {
  readonly seen: Array<{ requestId: string; profile: AuthorityApprovalProfile }> = [];
  private resolveRequest: ((result: LocalAuthorityBrokerResult) => void) | undefined;

  async request(input: { requestId: string; profile: AuthorityApprovalProfile }): Promise<LocalAuthorityBrokerResult> {
    this.seen.push(input);
    return new Promise<LocalAuthorityBrokerResult>((resolve) => {
      this.resolveRequest = resolve;
    });
  }

  complete(outcome: LocalAuthorityOutcome = "authenticated"): void {
    const input = this.seen.at(-1);
    if (!input || !this.resolveRequest) throw new Error("No pending broker request.");
    this.resolveRequest({
      requestId: input.requestId,
      profile: input.profile,
      approved: outcome === "authenticated",
      outcome,
    });
    this.resolveRequest = undefined;
  }
}

async function fixture(
  approvalBroker: LocalAuthorityBroker = new ImmediateBroker(),
  terminalEnabled = false,
) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: terminalEnabled, commands: ["node", "git"] },
    http: { host: "127.0.0.1", port: 4312 },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
  };
  return {
    base,
    auditFile: config.auditFile,
    runtime: createRuntimeServices(config, { approvalBroker }),
  };
}

async function sendRaw(socketPath: string, payload: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const chunks: Buffer[] = [];
    socket.setTimeout(2_000);
    socket.on("connect", () => socket.write(payload, "utf8"));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("timeout", () => socket.destroy(new Error("timeout")));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function sendControl(socketPath: string, value: unknown): Promise<Record<string, any>> {
  return JSON.parse(await sendRaw(socketPath, `${JSON.stringify(value)}\n`)) as Record<string, any>;
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

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition.");
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

  it("mints a user lease in the shared runtime only after local authentication", async () => {
    const broker = new ImmediateBroker("authenticated");
    const { base, runtime } = await fixture(broker);
    const socketPath = path.join(base, "control.sock");
    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const response = await sendControl(socketPath, {
      version: 1,
      action: "authorize",
      profile: "user",
      requestedTtlSeconds: 75,
    });

    expect(response).toMatchObject({
      version: 1,
      ok: true,
      lease: {
        leaseId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
        profile: "user",
        terminalEnabled: false,
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
    expect(response.lease.roots).toHaveLength(1);
    expect(runtime.authority.resolve(response.lease.leaseId)).toMatchObject({
      profile: "user",
      terminalEnabled: false,
      commands: [],
    });
    expect(broker.seen).toHaveLength(1);
  });

  it("mints a terminal-capable admin lease only after local authentication", async () => {
    const { base, runtime } = await fixture(new ImmediateBroker("authenticated"), true);
    const socketPath = path.join(base, "control.sock");
    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const response = await sendControl(socketPath, {
      version: 1,
      action: "authorize",
      profile: "admin",
      requestedTtlSeconds: 60,
    });

    expect(response).toMatchObject({
      version: 1,
      ok: true,
      lease: {
        profile: "admin",
        roots: [path.parse(process.cwd()).root],
        terminalEnabled: true,
      },
    });
    expect(runtime.authority.resolve(response.lease.leaseId).commands).toEqual(["node", "git"]);
  });

  it.each(["denied", "cancelled", "failed", "unavailable"] as const)(
    "never mints a lease after native outcome %s",
    async (outcome) => {
      const { base, runtime } = await fixture(new ImmediateBroker(outcome));
      const socketPath = path.join(base, "control.sock");
      const handle = await startControlServer({ socketPath, runtime });
      handles.push(handle);

      const response = await sendControl(socketPath, {
        version: 1,
        action: "authorize",
        profile: "user",
      });
      expect(response.ok).toBe(false);
      expect(response).not.toHaveProperty("lease");
    },
  );

  it("allows only one native authorization to be in flight", async () => {
    const broker = new DeferredBroker();
    const { base, runtime } = await fixture(broker);
    const socketPath = path.join(base, "control.sock");
    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const first = sendControl(socketPath, { version: 1, action: "authorize", profile: "user" });
    await waitFor(async () => broker.seen.length === 1);

    const second = await sendControl(socketPath, { version: 1, action: "authorize", profile: "admin" });
    expect(second).toMatchObject({ version: 1, ok: false, error: "AUTHORIZATION_BUSY" });

    broker.complete("authenticated");
    await expect(first).resolves.toMatchObject({ ok: true, lease: { profile: "user" } });
  });

  it("keeps request and lease ids out of audit records", async () => {
    const broker = new ImmediateBroker("authenticated");
    const { base, runtime, auditFile } = await fixture(broker);
    const socketPath = path.join(base, "control.sock");
    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const response = await sendControl(socketPath, {
      version: 1,
      action: "authorize",
      profile: "user",
      requestedTtlSeconds: 999_999,
    });
    const requestId = broker.seen[0]!.requestId;
    const leaseId = response.lease.leaseId as string;
    await runtime.authorityRequests.flushAudit();
    await runtime.authority.flushAudit();

    const audit = await readFile(auditFile, "utf8");
    expect(audit).not.toContain(requestId);
    expect(audit).not.toContain(leaseId);
    expect(audit).toContain('"action":"authority.request.created"');
    expect(audit).toContain('"action":"authority.start"');

    const resolved = runtime.authority.resolve(leaseId);
    expect(Date.parse(resolved.expiresAt) - Date.parse(resolved.createdAt)).toBeLessThanOrEqual(4 * 60 * 60 * 1000);
  });

  it("revokes a lease if the client disconnects before successful delivery", async () => {
    const broker = new DeferredBroker();
    const { base, runtime, auditFile } = await fixture(broker);
    const socketPath = path.join(base, "control.sock");
    const handle = await startControlServer({ socketPath, runtime });
    handles.push(handle);

    const socket = createConnection(socketPath);
    await once(socket, "connect");
    socket.write(`${JSON.stringify({ version: 1, action: "authorize", profile: "user" })}\n`);
    await waitFor(async () => broker.seen.length === 1);
    socket.destroy();
    broker.complete("authenticated");

    await waitFor(async () => {
      try {
        const audit = await readFile(auditFile, "utf8");
        return audit.includes('"action":"authority.start"') && audit.includes('"action":"authority.end"');
      } catch {
        return false;
      }
    });
    await runtime.authority.flushAudit();
  });
});
