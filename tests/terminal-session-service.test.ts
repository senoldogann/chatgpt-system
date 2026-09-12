import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import type { OwnerRuntimeConfig } from "../src/config.js";
import { PathPolicy } from "../src/policy.js";
import type { TerminalPtyBackend, TerminalPtyExit, TerminalPtyHandle, TerminalPtySpawnInput } from "../src/terminal-pty-backend.js";
import { TerminalSessionService } from "../src/terminal-session-service.js";
import { TerminalSessionSupervisor } from "../src/terminal-session-supervisor.js";

class FakePty implements TerminalPtyHandle {
  cols: number;
  rows: number;
  readonly writes: string[] = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalPtyExit) => void>();

  constructor(readonly pid: number, cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(data: string): void { this.writes.push(data); }
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  kill(): void {}
  onData(listener: (data: string) => void) { this.dataListeners.add(listener); return { dispose: () => this.dataListeners.delete(listener) }; }
  onExit(listener: (event: TerminalPtyExit) => void) { this.exitListeners.add(listener); return { dispose: () => this.exitListeners.delete(listener) }; }
  emitData(data: string): void { for (const listener of this.dataListeners) listener(data); }
  emitExit(event: TerminalPtyExit): void { for (const listener of [...this.exitListeners]) listener(event); }
}

class FakeBackend implements TerminalPtyBackend {
  readonly handles: FakePty[] = [];
  readonly inputs: TerminalPtySpawnInput[] = [];
  constructor(private readonly failure?: Error) {}
  async spawn(input: TerminalPtySpawnInput): Promise<TerminalPtyHandle> {
    if (this.failure) throw this.failure;
    this.inputs.push(input);
    const handle = new FakePty(7000 + this.handles.length, input.cols, input.rows);
    this.handles.push(handle);
    return handle;
  }
}

const cleanups: string[] = [];

function config(enabled: boolean, overrides: Partial<OwnerRuntimeConfig> = {}): OwnerRuntimeConfig {
  return {
    enabled,
    shellPath: "/bin/sh",
    maxScriptBytes: 262_144,
    maxTerminalSessions: 4,
    maxTerminalOutputBytes: 1024,
    maxTerminalInputBytes: 64,
    ...overrides,
  };
}

async function fixture(options: { admin?: boolean; enabled?: boolean; maxSessions?: number; backend?: FakeBackend } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-terminal-service-"));
  cleanups.push(root);
  const backend = options.backend ?? new FakeBackend();
  const supervisor = new TerminalSessionSupervisor({
    backend,
    maxSessions: options.maxSessions ?? 4,
    maxOutputBytes: 1024,
    maxInputBytes: 64,
    processStopGraceMs: 5,
    signalProcess: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); },
  });
  const service = new TerminalSessionService(
    new PathPolicy([root]),
    new AuditLogger(path.join(root, "audit.jsonl")),
    supervisor,
    config(options.enabled ?? true, { maxTerminalSessions: options.maxSessions ?? 4 }),
    options.admin ?? true,
  );
  return { root, backend, supervisor, service };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("TerminalSessionService", () => {
  it("denies non-Admin scopes and disabled Owner Runtime before session work", async () => {
    const nonAdmin = await fixture({ admin: false });
    await expect(nonAdmin.service.list()).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await nonAdmin.supervisor.close();

    const disabled = await fixture({ enabled: false });
    await expect(disabled.service.open({})).rejects.toMatchObject({ code: "OWNER_RUNTIME_DISABLED" });
    await disabled.supervisor.close();
  });

  it("opens with bounded defaults and a later Admin service can rediscover and manage the same daemon session", async () => {
    const { root, backend, supervisor, service } = await fixture();
    const opened = await service.open({ cwd: root });
    expect(opened).toMatchObject({ cwd: root, state: "running", cols: 120, rows: 30 });

    const laterAdmin = new TerminalSessionService(
      new PathPolicy([root]),
      new AuditLogger(path.join(root, "audit-later.jsonl")),
      supervisor,
      config(true),
      true,
    );
    expect((await laterAdmin.list()).sessions.map((item) => item.sessionId)).toContain(opened.sessionId);

    backend.handles[0]!.emitData("hello");
    expect(await laterAdmin.read(opened.sessionId)).toMatchObject({ data: "hello", nextSequence: 1 });
    await laterAdmin.write(opened.sessionId, "echo next\r");
    await laterAdmin.resize(opened.sessionId, 100, 40);
    expect(backend.handles[0]!.writes).toEqual(["echo next\r"]);
    expect((await laterAdmin.list()).sessions[0]).toMatchObject({ cols: 100, rows: 40 });
    await laterAdmin.close(opened.sessionId);
  });

  it("hides unknown and out-of-scope sessions behind the same not-found error", async () => {
    const { root, supervisor, service } = await fixture();
    await expect(service.read("x".repeat(43))).rejects.toMatchObject({ code: "TERMINAL_SESSION_NOT_FOUND" });

    const outside = await mkdtemp(path.join(tmpdir(), "chatgpt-system-terminal-outside-"));
    cleanups.push(outside);
    const hidden = await supervisor.open({ shellPath: "/bin/sh", cwd: outside, cols: 80, rows: 24 });
    expect((await service.list()).sessions).toEqual([]);
    await expect(service.write(hidden.sessionId, "secret")).rejects.toMatchObject({ code: "TERMINAL_SESSION_NOT_FOUND" });
    await supervisor.close();
    expect(root).not.toBe(outside);
  });

  it("rejects writes/resizes to completed sessions and keeps close idempotent", async () => {
    const { backend, supervisor, service } = await fixture();
    const opened = await service.open({});
    backend.handles[0]!.emitExit({ exitCode: 0 });

    await expect(service.write(opened.sessionId, "x")).rejects.toMatchObject({ code: "TERMINAL_SESSION_CLOSED" });
    await expect(service.resize(opened.sessionId, 80, 24)).rejects.toMatchObject({ code: "TERMINAL_SESSION_CLOSED" });
    await expect(service.close(opened.sessionId)).resolves.toMatchObject({ state: "exited" });
    await expect(service.close(opened.sessionId)).resolves.toMatchObject({ state: "exited" });
    await supervisor.close();
  });

  it("validates dimensions, input bytes, and output cursors before native work", async () => {
    const { backend, supervisor, service } = await fixture();
    await expect(service.open({ cols: 0 })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(service.open({ rows: 1001 })).rejects.toMatchObject({ code: "POLICY_DENIED" });

    const opened = await service.open({});
    await expect(service.write(opened.sessionId, "x".repeat(65))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(backend.handles[0]!.writes).toEqual([]);
    await expect(service.read(opened.sessionId, 1)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(service.resize(opened.sessionId, 1.5, 20)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await supervisor.close();
  });

  it("maps registry capacity and backend failures to terminal-specific stable errors", async () => {
    const capacity = await fixture({ maxSessions: 1 });
    await capacity.service.open({});
    await expect(capacity.service.open({})).rejects.toMatchObject({ code: "TERMINAL_SESSION_LIMIT" });
    await capacity.supervisor.close();

    const failing = await fixture({ backend: new FakeBackend(new Error("native-secret-detail")) });
    await expect(failing.service.open({})).rejects.toMatchObject({
      code: "TERMINAL_SESSION_FAILED",
      message: expect.not.stringContaining("native-secret-detail"),
    });
    await failing.supervisor.close();
  });
});
