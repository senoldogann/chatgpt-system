import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { AppError } from "../src/errors.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-audit-error-"));
  cleanups.push(base);
  const auditFile = path.join(base, "audit.jsonl");
  return { auditFile, audit: new AuditLogger(auditFile) };
}

describe("AuditLogger error redaction", () => {
  it("records only a stable AppError code and never its message or details", async () => {
    const { auditFile, audit } = await fixture();
    const messageCanary = "MESSAGE_SECRET_CANARY";
    const detailCanary = "DETAIL_SECRET_CANARY";

    await expect(audit.run("test.app_error", undefined, async () => {
      throw new AppError(`failure ${messageCanary}`, "TEST_STABLE_ERROR", {
        retryable: false,
        secret: detailCanary,
      });
    }, { operation: "fixture" })).rejects.toMatchObject({ code: "TEST_STABLE_ERROR" });

    const raw = await readFile(auditFile, "utf8");
    expect(raw).toContain('"errorCode":"TEST_STABLE_ERROR"');
    expect(raw).toContain('"operation":"fixture"');
    expect(raw).not.toContain(messageCanary);
    expect(raw).not.toContain(detailCanary);
    expect(raw).not.toContain('"error":"failure');
  });

  it("classifies unexpected errors without copying their message", async () => {
    const { auditFile, audit } = await fixture();
    const messageCanary = "UNEXPECTED_SECRET_CANARY";

    await expect(audit.run("test.internal_error", undefined, async () => {
      throw new Error(`unexpected ${messageCanary}`);
    })).rejects.toThrow(messageCanary);

    const raw = await readFile(auditFile, "utf8");
    expect(raw).toContain('"errorCode":"INTERNAL_ERROR"');
    expect(raw).not.toContain(messageCanary);
  });
});
