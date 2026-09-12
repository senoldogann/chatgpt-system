import { describe, expect, it, vi } from "vitest";
import type {
  TerminalPtyBackend,
  TerminalPtyExit,
  TerminalPtyHandle,
  TerminalPtySpawnInput,
} from "../src/terminal-pty-backend.js";
import { TerminalSessionSupervisor } from "../src/terminal-session-supervisor.js";

class FakePty implements TerminalPtyHandle {
  cols: number;
  rows: number;
  readonly writes: string[] = [];
  readonly resizes: Array<[number, number]> = [];
  readonly kills: Array<string | undefined> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalPtyExit) => void>();

  constructor(readonly pid: number, cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.resizes.push([cols, rows]);
  }

  kill(signal?: string): void {
    this.kills.push(signal);
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener: (event: TerminalPtyExit) => void): { dispose(): void } {
    this.exitListeners.add(listener);
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  emitExit(event: TerminalPtyExit): void {
    for (const listener of [...this.exitListeners]) listener(event);
  }
}

class FakeBackend implements TerminalPtyBackend {
  readonly inputs: TerminalPtySpawnInput[] = [];
  readonly handles: FakePty[] = [];

  async spawn(input: TerminalPtySpawnInput): Promise<TerminalPtyHandle> {
    this.inputs.push(input);
    const handle = new FakePty(4000 + this.handles.length, input.cols, input.rows);
    this.handles.push(handle);
    return handle;
  }
}

function createSupervisor(extra: Partial<ConstructorParameters<typeof TerminalSessionSupervisor>[0]> = {}) {
  const backend = new FakeBackend();
  const supervisor = new TerminalSessionSupervisor({
    backend,
    maxSessions: 4,
    maxOutputBytes: 64,
    maxInputBytes: 64,
    processStopGraceMs: 10,
    ...extra,
  });
  return { backend, supervisor };
}

const openInput = {
  shellPath: "/bin/zsh",
  cwd: "/tmp",
  cols: 120,
  rows: 30,
};

describe("TerminalSessionSupervisor", () => {
  it("creates opaque session ids and never exposes the native pid", async () => {
    const { backend, supervisor } = createSupervisor();
    const summary = await supervisor.open(openInput);

    expect(summary.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(summary).not.toHaveProperty("pid");
    expect(supervisor.status(summary.sessionId)).not.toHaveProperty("pid");
    expect(backend.inputs[0]).toMatchObject({
      file: "/bin/zsh",
      args: ["-l"],
      cwd: "/tmp",
      cols: 120,
      rows: 30,
    });
    expect(backend.inputs[0]?.env.TERM).toBe("xterm-256color");
    await supervisor.close();
  });

  it("tracks output by event sequence and delegates write and resize while running", async () => {
    const { backend, supervisor } = createSupervisor();
    const summary = await supervisor.open(openInput);
    const handle = backend.handles[0]!;

    handle.emitData("alpha");
    handle.emitData("beta");
    expect(supervisor.read(summary.sessionId, 0)).toMatchObject({
      sessionId: summary.sessionId,
      data: "alphabeta",
      nextSequence: 2,
      truncatedBefore: false,
    });

    supervisor.write(summary.sessionId, "echo hi\r");
    supervisor.resize(summary.sessionId, 100, 40);
    expect(handle.writes).toEqual(["echo hi\r"]);
    expect(handle.resizes).toEqual([[100, 40]]);
    expect(supervisor.status(summary.sessionId)).toMatchObject({ cols: 100, rows: 40 });
    await supervisor.close();
  });

  it("marks natural exit as exited and explicit stop as stopped", async () => {
    const backend = new FakeBackend();
    const byPid = new Map<number, FakePty>();
    const supervisor = new TerminalSessionSupervisor({
      backend,
      maxSessions: 4,
      maxOutputBytes: 64,
      maxInputBytes: 64,
      processStopGraceMs: 10,
      signalProcess: (target, signal) => {
        const handle = byPid.get(Math.abs(target));
        if (signal === "SIGTERM") handle?.emitExit({ exitCode: 0, signal: 15 });
      },
    });

    const natural = await supervisor.open(openInput);
    byPid.set(backend.handles[0]!.pid, backend.handles[0]!);
    backend.handles[0]!.emitExit({ exitCode: 7, signal: 0 });
    expect(supervisor.status(natural.sessionId)).toMatchObject({ state: "exited", exitCode: 7 });

    const stopped = await supervisor.open(openInput);
    byPid.set(backend.handles[1]!.pid, backend.handles[1]!);
    await supervisor.stop(stopped.sessionId);
    expect(supervisor.status(stopped.sessionId)).toMatchObject({ state: "stopped" });
    await supervisor.close();
  });

  it("evicts the oldest completed session first but never a running session", async () => {
    const { backend, supervisor } = createSupervisor({ maxSessions: 2 });
    const first = await supervisor.open(openInput);
    backend.handles[0]!.emitExit({ exitCode: 0 });
    const second = await supervisor.open(openInput);
    const third = await supervisor.open(openInput);

    expect(supervisor.status(first.sessionId)).toBeUndefined();
    expect(supervisor.status(second.sessionId)?.state).toBe("running");
    expect(supervisor.status(third.sessionId)?.state).toBe("running");
    await expect(supervisor.open(openInput)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await supervisor.close();
  });

  it("treats ESRCH as an already-gone process group instead of waiting forever", async () => {
    const backend = new FakeBackend();
    const supervisor = new TerminalSessionSupervisor({
      backend,
      maxSessions: 2,
      maxOutputBytes: 64,
      maxInputBytes: 64,
      processStopGraceMs: 5,
      signalProcess: () => {
        throw Object.assign(new Error("gone"), { code: "ESRCH" });
      },
    });
    const summary = await supervisor.open(openInput);

    await expect(supervisor.stop(summary.sessionId)).resolves.toMatchObject({ state: "stopped" });
    expect(supervisor.status(summary.sessionId)).toMatchObject({
      state: "stopped",
      exitCode: null,
      signal: null,
    });
  });

  it("escalates from process-group SIGTERM to SIGKILL after the grace period", async () => {
    const backend = new FakeBackend();
    const signals: Array<{ target: number; signal: NodeJS.Signals }> = [];
    let handle: FakePty | undefined;
    const supervisor = new TerminalSessionSupervisor({
      backend,
      maxSessions: 2,
      maxOutputBytes: 64,
      maxInputBytes: 64,
      processStopGraceMs: 5,
      signalProcess: (target, signal) => {
        signals.push({ target, signal });
        if (signal === "SIGKILL") handle?.emitExit({ exitCode: 0, signal: 9 });
      },
    });
    const summary = await supervisor.open(openInput);
    handle = backend.handles[0]!;

    await supervisor.stop(summary.sessionId);
    expect(signals).toEqual([
      { target: -handle.pid, signal: "SIGTERM" },
      { target: -handle.pid, signal: "SIGKILL" },
    ]);
    expect(supervisor.status(summary.sessionId)?.state).toBe("stopped");
  });

  it("daemon close stops every running session and is idempotent", async () => {
    const backend = new FakeBackend();
    const byPid = new Map<number, FakePty>();
    const signalProcess = vi.fn((target: number, signal: NodeJS.Signals) => {
      if (signal === "SIGTERM") byPid.get(Math.abs(target))?.emitExit({ exitCode: 0, signal: 15 });
    });
    const supervisor = new TerminalSessionSupervisor({
      backend,
      maxSessions: 4,
      maxOutputBytes: 64,
      maxInputBytes: 64,
      processStopGraceMs: 10,
      signalProcess,
    });
    const one = await supervisor.open(openInput);
    byPid.set(backend.handles[0]!.pid, backend.handles[0]!);
    const two = await supervisor.open(openInput);
    byPid.set(backend.handles[1]!.pid, backend.handles[1]!);

    await supervisor.close();
    await supervisor.close();

    expect(supervisor.status(one.sessionId)?.state).toBe("stopped");
    expect(supervisor.status(two.sessionId)?.state).toBe("stopped");
    expect(signalProcess).toHaveBeenCalledTimes(2);
  });
});
