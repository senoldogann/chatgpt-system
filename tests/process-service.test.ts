import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLogger } from "../src/audit.js";
import type { AppConfig } from "../src/config.js";
import { PolicyError } from "../src/errors.js";
import { PathPolicy } from "../src/policy.js";
import { ProcessService } from "../src/process-service.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(enabled: boolean) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-process-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled, commands: ["node"] },
    http: { host: "127.0.0.1", port: 4312 },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
  };
  return new ProcessService(new PathPolicy([root]), new AuditLogger(config.auditFile), config);
}

describe("ProcessService", () => {
  it("is disabled by default/policy", async () => {
    const service = await fixture(false);
    await expect(service.run("node", ["--version"])).rejects.toBeInstanceOf(PolicyError);
  });

  it("rejects executables outside the allowlist", async () => {
    const service = await fixture(true);
    await expect(service.run("sh", ["-c", "echo nope"])).rejects.toBeInstanceOf(PolicyError);
  });

  it("rejects executable paths even if the basename is allowlisted", async () => {
    const service = await fixture(true);
    await expect(service.run("/usr/bin/node", ["--version"])).rejects.toBeInstanceOf(PolicyError);
  });
});
