import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";

export interface AuditEvent {
  action: string;
  target?: string;
  outcome: "ok" | "error";
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  constructor(private readonly file: string) {}

  async record(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const line = JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    });
    await appendFile(this.file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
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
      await this.record({ action, ...(target ? { target } : {}), outcome: "ok", durationMs: performance.now() - started, ...(metadata ? { metadata } : {}) });
      return result;
    } catch (error) {
      await this.record({
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
}
