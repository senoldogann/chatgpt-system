import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";

export const AUDIT_MAX_FILE_BYTES = 16 * 1024 * 1024;

export interface AuditEvent {
  action: string;
  target?: string;
  outcome: "ok" | "error";
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface AuditLoggerOptions {
  maxFileBytes?: number;
  onWriteError?: () => void;
}

export class AuditLogger {
  private readonly maxFileBytes: number;
  private readonly onWriteError: (() => void) | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    options: AuditLoggerOptions = {},
  ) {
    this.maxFileBytes = options.maxFileBytes ?? AUDIT_MAX_FILE_BYTES;
    if (!Number.isInteger(this.maxFileBytes) || this.maxFileBytes <= 0) {
      throw new Error("Audit file byte limit must be a positive integer.");
    }
    this.onWriteError = options.onWriteError;
  }

  record(event: AuditEvent): Promise<void> {
    const operation = this.writeChain.then(() => this.writeRecord(event));
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  async run<T>(
    action: string,
    target: string | undefined,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const started = performance.now();
    try {
      const result = await fn();
      await this.recordBestEffort({
        action,
        ...(target ? { target } : {}),
        outcome: "ok",
        durationMs: performance.now() - started,
        ...(metadata ? { metadata } : {}),
      });
      return result;
    } catch (error) {
      await this.recordBestEffort({
        action,
        ...(target ? { target } : {}),
        outcome: "error",
        durationMs: performance.now() - started,
        metadata: {
          ...(metadata ?? {}),
          errorCode: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async recordBestEffort(event: AuditEvent): Promise<void> {
    try {
      await this.record(event);
    } catch {
      try {
        this.onWriteError?.();
      } catch {
        // Fallback reporting must not change operation semantics.
      }
    }
  }

  private async writeRecord(event: AuditEvent): Promise<void> {
    const line = `${JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    })}\n`;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > this.maxFileBytes) {
      throw new Error("Audit record exceeds the configured file byte limit.");
    }

    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await this.rotateIfNeeded(lineBytes);
    await appendFile(this.file, line, { encoding: "utf8", mode: 0o600 });
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentSize = 0;
    try {
      currentSize = (await stat(this.file)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (currentSize + incomingBytes <= this.maxFileBytes) return;

    const rotated = `${this.file}.1`;
    await rm(rotated, { force: true });

    if (currentSize > 0 && currentSize <= this.maxFileBytes) {
      await rename(this.file, rotated);
      return;
    }

    if (currentSize > this.maxFileBytes) {
      await rm(this.file, { force: true });
    }
  }
}
