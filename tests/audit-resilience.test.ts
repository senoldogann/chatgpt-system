import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { AppError } from "../src/errors.js";

const cleanups: string[] = [];

type AuditLoggerOptions = {
  maxFileBytes?: number;
  onWriteError?: () => void;
};

function createAuditLogger(file: string, options?: AuditLoggerOptions): AuditLogger {
  const Constructor = AuditLogger as unknown as new (
    file: string,
    options?: AuditLoggerOptions,
  ) => AuditLogger;
  return new Constructor(file, options);
}

async function tempDir(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-audit-resilience-"));
  cleanups.push(base);
  return base;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("AuditLogger resilience", () => {
  it("preserves a successful operation result when audit persistence fails", async () => {
    const base = await tempDir();
    const blockingFile = path.join(base, "not-a-directory");
    await writeFile(blockingFile, "blocked\n", "utf8");
    const onWriteError = vi.fn();
    const audit = createAuditLogger(path.join(blockingFile, "audit.jsonl"), { onWriteError });
    let effects = 0;

    await expect(audit.run("test.mutation", ".", async () => {
      effects += 1;
      return "done";
    })).resolves.toBe("done");

    expect(effects).toBe(1);
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(onWriteError).toHaveBeenCalledWith();
  });

  it("preserves the original operation error when error-audit persistence also fails", async () => {
    const base = await tempDir();
    const blockingFile = path.join(base, "not-a-directory");
    await writeFile(blockingFile, "blocked\n", "utf8");
    const onWriteError = vi.fn();
    const audit = createAuditLogger(path.join(blockingFile, "audit.jsonl"), { onWriteError });
    const original = new AppError("operation failed", "TEST_OPERATION_FAILED");

    let received: unknown;
    try {
      await audit.run("test.failure", undefined, async () => {
        throw original;
      });
    } catch (error) {
      received = error;
    }

    expect(received).toBe(original);
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(onWriteError).toHaveBeenCalledWith();
  });

  it("serializes concurrent records and keeps active plus one rotated generation bounded", async () => {
    const base = await tempDir();
    const auditFile = path.join(base, "audit.jsonl");
    const maxFileBytes = 1_024;
    const audit = createAuditLogger(auditFile, { maxFileBytes });

    await Promise.all(Array.from({ length: 24 }, (_, index) => audit.record({
      action: "test.rotation",
      outcome: "ok",
      durationMs: index,
      metadata: { index, payload: "x".repeat(120) },
    })));

    const activeStat = await stat(auditFile);
    const rotatedStat = await stat(`${auditFile}.1`);
    expect(activeStat.size).toBeLessThanOrEqual(maxFileBytes);
    expect(rotatedStat.size).toBeLessThanOrEqual(maxFileBytes);

    for (const file of [`${auditFile}.1`, auditFile]) {
      const raw = await readFile(file, "utf8");
      expect(raw.endsWith("\n")).toBe(true);
      const lines = raw.trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("rejects a single audit record larger than the configured file budget", async () => {
    const base = await tempDir();
    const auditFile = path.join(base, "audit.jsonl");
    const audit = createAuditLogger(auditFile, { maxFileBytes: 256 });

    await expect(audit.record({
      action: "test.oversized",
      outcome: "ok",
      durationMs: 0,
      metadata: { payload: "x".repeat(1_024) },
    })).rejects.toThrow(/audit.*(limit|budget|large)/i);

    await expect(access(auditFile)).rejects.toBeDefined();
  });
});
