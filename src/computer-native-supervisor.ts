import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { ComputerError } from "./computer-errors.js";
import { ComputerNativeClient } from "./computer-native-client.js";
import type { ComputerNativeMethod } from "./computer-types.js";

export interface ComputerSpawnOptions {
  shell: false;
  stdio: ["pipe", "pipe", "pipe"];
}

export type ComputerSpawn = (
  command: string,
  args: readonly string[],
  options: ComputerSpawnOptions,
) => ChildProcess;

export interface ComputerNativeSupervisorOptions {
  enabled: boolean;
  hostBundlePath: string;
  requestTimeoutMs: number;
  stderrLimitBytes?: number;
  closeGraceMs?: number;
  spawnImpl?: ComputerSpawn;
}

type SupervisorState = "disabled" | "stopped" | "running" | "unavailable";

type HostRecord = {
  child: ChildProcess;
  client: ComputerNativeClient;
  closed: Promise<void>;
  resolveClosed: () => void;
};

class TailBuffer {
  private value = Buffer.alloc(0);
  private wasTruncated = false;

  constructor(private readonly maxBytes: number) {}

  reset(): void {
    this.value = Buffer.alloc(0);
    this.wasTruncated = false;
  }

  append(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.length === 0) return;
    const combined = Buffer.concat([this.value, bytes]);
    if (combined.length <= this.maxBytes) {
      this.value = combined;
      return;
    }
    this.wasTruncated = true;
    this.value = Buffer.from(combined.subarray(combined.length - this.maxBytes));
  }

  snapshot(): { content: string; bytes: number; truncated: boolean } {
    return {
      content: this.value.toString("utf8"),
      bytes: this.value.length,
      truncated: this.wasTruncated,
    };
  }
}

function defaultSpawn(command: string, args: readonly string[], options: ComputerSpawnOptions): ChildProcess {
  return spawn(command, [...args], options);
}

export class ComputerNativeSupervisor {
  private readonly executablePath: string;
  private readonly requestTimeoutMs: number;
  private readonly closeGraceMs: number;
  private readonly spawnImpl: ComputerSpawn;
  private readonly stderrTail: TailBuffer;
  private current: HostRecord | undefined;
  private startPromise: Promise<HostRecord> | undefined;
  private closePromise: Promise<void> | undefined;
  private closing = false;
  private unavailable = false;

  constructor(private readonly options: ComputerNativeSupervisorOptions) {
    if (!Number.isInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new Error("Computer native request timeout must be a positive integer.");
    }
    const stderrLimitBytes = options.stderrLimitBytes ?? 16_384;
    if (!Number.isInteger(stderrLimitBytes) || stderrLimitBytes <= 0) {
      throw new Error("Computer native stderr limit must be a positive integer.");
    }
    this.closeGraceMs = options.closeGraceMs ?? 500;
    if (!Number.isInteger(this.closeGraceMs) || this.closeGraceMs <= 0) {
      throw new Error("Computer native close grace must be a positive integer.");
    }

    this.requestTimeoutMs = options.requestTimeoutMs;
    this.spawnImpl = options.spawnImpl ?? defaultSpawn;
    this.stderrTail = new TailBuffer(stderrLimitBytes);
    this.executablePath = path.join(
      options.hostBundlePath,
      "Contents",
      "MacOS",
      "chatgpt-system-computer-runtime",
    );
  }

  healthState(): SupervisorState {
    if (!this.options.enabled) return "disabled";
    if (this.current) return "running";
    if (this.unavailable || this.closing) return "unavailable";
    return "stopped";
  }

  async request(
    method: ComputerNativeMethod,
    params: Record<string, unknown>,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    if (!this.options.enabled) throw new ComputerError("COMPUTER_DISABLED");
    if (this.closing) throw new ComputerError("COMPUTER_UNAVAILABLE");
    const record = await this.ensureStarted();
    return record.client.request(method, params, Math.min(timeoutMs, this.requestTimeoutMs));
  }

  diagnosticStderr(): { content: string; bytes: number; truncated: boolean } {
    return this.stderrTail.snapshot();
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = this.closeOwnedHost();
    return this.closePromise;
  }

  private async ensureStarted(): Promise<HostRecord> {
    if (this.current) return this.current;
    if (this.closing) throw new ComputerError("COMPUTER_UNAVAILABLE");
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startHost();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startHost(): Promise<HostRecord> {
    this.stderrTail.reset();
    let child: ChildProcess;
    try {
      child = this.spawnImpl(this.executablePath, [], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      this.unavailable = true;
      throw new ComputerError("COMPUTER_UNAVAILABLE");
    }

    if (!child.stdin || !child.stdout || !child.stderr) {
      this.unavailable = true;
      child.kill("SIGTERM");
      throw new ComputerError("COMPUTER_UNAVAILABLE");
    }

    child.stderr.on("data", (chunk: Buffer | string) => this.stderrTail.append(chunk));

    await this.waitForSpawn(child);
    if (this.closing) {
      child.kill("SIGTERM");
      throw new ComputerError("COMPUTER_UNAVAILABLE");
    }

    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    let record!: HostRecord;
    const client = new ComputerNativeClient({
      stdin: child.stdin,
      stdout: child.stdout,
      onFatal: (error) => {
        this.invalidateRecord(record, error);
      },
    });
    record = { child, client, closed, resolveClosed };

    child.once("close", () => {
      record.resolveClosed();
      if (this.current !== record) return;
      this.current = undefined;
      if (!this.closing) {
        this.unavailable = true;
        record.client.close(new ComputerError("COMPUTER_UNAVAILABLE"));
      }
    });
    child.on("error", () => {
      if (this.current === record && !this.closing) {
        this.invalidateRecord(record, new ComputerError("COMPUTER_UNAVAILABLE"));
      }
    });

    this.current = record;
    this.unavailable = false;
    return record;
  }

  private waitForSpawn(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const onSpawn = () => {
        if (settled) return;
        settled = true;
        child.off("error", onError);
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        child.off("spawn", onSpawn);
        this.unavailable = true;
        reject(new ComputerError("COMPUTER_UNAVAILABLE"));
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  private invalidateRecord(record: HostRecord, error: ComputerError): void {
    if (this.current !== record) return;
    this.current = undefined;
    this.unavailable = true;
    record.client.close(error);
    if (!record.child.killed) record.child.kill("SIGTERM");
  }

  private async closeOwnedHost(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // Failed start leaves no owned child to close.
      }
    }

    const record = this.current;
    if (!record) return;
    this.current = undefined;
    record.client.close(new ComputerError("COMPUTER_UNAVAILABLE"));

    try {
      record.child.stdin?.end();
    } catch {
      // Graceful EOF is best effort before owned-child termination.
    }

    const closedGracefully = await this.waitForClose(record, this.closeGraceMs);
    if (!closedGracefully && !record.child.killed) {
      record.child.kill("SIGTERM");
      await this.waitForClose(record, this.closeGraceMs);
    }
  }

  private waitForClose(record: HostRecord, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      void record.closed.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}
