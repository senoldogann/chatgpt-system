import { randomBytes } from "node:crypto";
import { LimitError } from "./errors.js";
import { sanitizedChildEnvironment } from "./process-policy.js";
import type { TerminalPtyBackend, TerminalPtyHandle } from "./terminal-pty-backend.js";
import { TerminalOutputBuffer } from "./terminal-output-buffer.js";

export type TerminalSessionState = "running" | "exited" | "stopped";

export interface TerminalSessionSummary {
  sessionId: string;
  cwd: string;
  state: TerminalSessionState;
  cols: number;
  rows: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: number | null;
  outputSequence: number;
}

export interface TerminalSessionReadResult {
  sessionId: string;
  state: TerminalSessionState;
  data: string;
  bytes: number;
  nextSequence: number;
  truncatedBefore: boolean;
}

export interface TerminalSessionDescriptor {
  sessionId: string;
  cwd: string;
}

interface TerminalSessionRecord {
  sessionId: string;
  cwd: string;
  state: TerminalSessionState;
  cols: number;
  rows: number;
  startedAt: string;
  startedAtMs: number;
  exitedAt?: string;
  exitCode?: number | null;
  signal?: number | null;
  pty: TerminalPtyHandle;
  output: TerminalOutputBuffer;
  terminationRequested: boolean;
  closed: Promise<void>;
  resolveClosed: () => void;
  terminationPromise?: Promise<void>;
}

export interface TerminalSessionSupervisorOptions {
  backend: TerminalPtyBackend;
  maxSessions: number;
  maxOutputBytes: number;
  maxInputBytes: number;
  processStopGraceMs: number;
  platform?: NodeJS.Platform;
  now?: () => number;
  newSessionId?: () => string;
  signalProcess?: (target: number, signal: NodeJS.Signals) => void;
}

function defaultSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function summary(record: TerminalSessionRecord): TerminalSessionSummary {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    state: record.state,
    cols: record.cols,
    rows: record.rows,
    startedAt: record.startedAt,
    ...(record.exitedAt !== undefined ? { exitedAt: record.exitedAt } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
    ...(record.signal !== undefined ? { signal: record.signal } : {}),
    outputSequence: record.output.sequence,
  };
}

function sanitizedTerminalEnvironment(): Record<string, string> {
  const source = sanitizedChildEnvironment();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM ??= "xterm-256color";
  return env;
}

export class TerminalSessionSupervisor {
  private readonly records = new Map<string, TerminalSessionRecord>();
  private readonly platform: NodeJS.Platform;
  private readonly now: () => number;
  private readonly newSessionId: () => string;
  private readonly signalProcess: (target: number, signal: NodeJS.Signals) => void;
  private pendingStarts = 0;
  private closing = false;

  constructor(private readonly options: TerminalSessionSupervisorOptions) {
    this.platform = options.platform ?? process.platform;
    this.now = options.now ?? Date.now;
    this.newSessionId = options.newSessionId ?? defaultSessionId;
    this.signalProcess = options.signalProcess ?? ((target, signal) => process.kill(target, signal));
  }

  async open(input: { shellPath: string; cwd: string; cols: number; rows: number }): Promise<TerminalSessionSummary> {
    if (this.closing) throw new Error("Terminal session supervisor is closing.");
    this.reserveCapacity();

    let pty: TerminalPtyHandle;
    try {
      pty = await this.options.backend.spawn({
        file: input.shellPath,
        args: ["-l"],
        cwd: input.cwd,
        env: sanitizedTerminalEnvironment(),
        cols: input.cols,
        rows: input.rows,
      });
    } catch (error) {
      this.pendingStarts -= 1;
      throw error;
    }

    this.pendingStarts -= 1;
    const startedAtMs = this.now();
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const record: TerminalSessionRecord = {
      sessionId: this.newUniqueSessionId(),
      cwd: input.cwd,
      state: "running",
      cols: input.cols,
      rows: input.rows,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      pty,
      output: new TerminalOutputBuffer(this.options.maxOutputBytes),
      terminationRequested: false,
      closed,
      resolveClosed,
    };
    this.records.set(record.sessionId, record);

    pty.onData((data) => {
      record.output.append(data);
    });
    pty.onExit((event) => {
      if (record.state !== "running") return;
      record.state = record.terminationRequested ? "stopped" : "exited";
      record.exitedAt = new Date(this.now()).toISOString();
      record.exitCode = event.exitCode;
      record.signal = event.signal ?? null;
      record.resolveClosed();
    });

    return summary(record);
  }

  descriptors(): TerminalSessionDescriptor[] {
    return [...this.records.values()].map((record) => ({
      sessionId: record.sessionId,
      cwd: record.cwd,
    }));
  }

  status(sessionId: string): TerminalSessionSummary | undefined {
    const record = this.records.get(sessionId);
    return record ? summary(record) : undefined;
  }

  read(sessionId: string, afterSequence = 0): TerminalSessionReadResult | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    const output = record.output.read(afterSequence);
    return {
      sessionId,
      state: record.state,
      ...output,
    };
  }

  write(sessionId: string, data: string): TerminalSessionSummary | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    if (record.state !== "running") return summary(record);
    if (Buffer.byteLength(data, "utf8") > this.options.maxInputBytes) {
      throw new LimitError("Terminal session input exceeds the configured byte limit.", {
        limit: this.options.maxInputBytes,
      });
    }
    record.pty.write(data);
    return summary(record);
  }

  resize(sessionId: string, cols: number, rows: number): TerminalSessionSummary | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    if (record.state !== "running") return summary(record);
    record.pty.resize(cols, rows);
    record.cols = cols;
    record.rows = rows;
    return summary(record);
  }

  async stop(sessionId: string): Promise<TerminalSessionSummary | undefined> {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    if (record.state !== "running") return summary(record);
    await this.terminate(record);
    return summary(record);
  }

  async close(): Promise<void> {
    this.closing = true;
    const running = [...this.records.values()].filter((record) => record.state === "running");
    await Promise.all(running.map((record) => this.terminate(record)));
  }

  private reserveCapacity(): void {
    while (this.records.size + this.pendingStarts >= this.options.maxSessions) {
      const completed = [...this.records.values()]
        .filter((record) => record.state !== "running")
        .sort((left, right) => left.startedAtMs - right.startedAtMs)[0];
      if (!completed) {
        throw new LimitError("Terminal session registry is full.", {
          limit: this.options.maxSessions,
        });
      }
      this.records.delete(completed.sessionId);
    }
    this.pendingStarts += 1;
  }

  private newUniqueSessionId(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = this.newSessionId();
      if (!this.records.has(sessionId)) return sessionId;
    }
    throw new Error("Could not allocate a unique terminal session id.");
  }

  private terminate(record: TerminalSessionRecord): Promise<void> {
    if (record.state !== "running") return Promise.resolve();
    if (record.terminationPromise) return record.terminationPromise;

    const attempt = this.terminateOnce(record);
    record.terminationPromise = attempt;
    void attempt.catch(() => {
      if (record.terminationPromise === attempt) delete record.terminationPromise;
    });
    return attempt;
  }

  private async terminateOnce(record: TerminalSessionRecord): Promise<void> {
    record.terminationRequested = true;
    if (!this.sendSignal(record, "SIGTERM")) {
      this.finishAlreadyGone(record);
      return;
    }

    const closedGracefully = await this.waitForClose(record, this.options.processStopGraceMs);
    if (!closedGracefully && record.state === "running") {
      if (!this.sendSignal(record, "SIGKILL")) {
        this.finishAlreadyGone(record);
        return;
      }
      await record.closed;
    }
  }

  private sendSignal(record: TerminalSessionRecord, signal: NodeJS.Signals): boolean {
    if (this.platform === "win32") {
      record.pty.kill(signal);
      return true;
    }

    try {
      this.signalProcess(-record.pty.pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  }

  private finishAlreadyGone(record: TerminalSessionRecord): void {
    if (record.state !== "running") return;
    record.state = "stopped";
    record.exitedAt = new Date(this.now()).toISOString();
    record.exitCode = null;
    record.signal = null;
    record.resolveClosed();
  }

  private async waitForClose(record: TerminalSessionRecord, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref();

      void record.closed.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
