import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuditLogger } from "../src/core/audit.js";
import { AuthorityManager } from "../src/core/authority.js";
import type { AppConfig } from "../src/core/config.js";
import { CommandTimeoutError, PolicyError } from "../src/core/errors.js";
import { PathPolicy } from "../src/core/policy.js";
import { ProcessService } from "../src/process/process-service.js";
import { createScopedRuntime } from "../src/core/scoped-runtime.js";

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
    projectExec: { enabled: false },
    // Yeni zorunlu bloklar: bu testin kapsamı dışında, kapalı tutulur.
    skills: { enabled: false, directory: path.join(base, "skills") },
    goal: { enabled: false, maxTranscriptChars: 120_000 },
    workers: { enabled: false, maxWorkers: 8, maxParkedRuns: 16 },
    http: { host: "127.0.0.1", port: 4312, allowNonLoopback: false },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
      processStopGraceMs: 200,
    },
  };
  return { base, root, config, service: new ProcessService(new PathPolicy([root]), new AuditLogger(config.auditFile), config) };
}

describe("ProcessService", () => {
  it("is disabled by default/policy", async () => {
    const { service } = await fixture(false);
    await expect(service.run("node", ["--version"])).rejects.toBeInstanceOf(PolicyError);
  });

  it("rejects executables outside the allowlist", async () => {
    const { service } = await fixture(true);
    await expect(service.run("sh", ["-c", "echo nope"])).rejects.toBeInstanceOf(PolicyError);
  });

  it("rejects executable paths even if the basename is allowlisted", async () => {
    const { service } = await fixture(true);
    await expect(service.run("/usr/bin/node", ["--version"])).rejects.toBeInstanceOf(PolicyError);
  });

  it("rejects terminal through a project lease even for allowlisted commands", async () => {
    const { base, root, config } = await fixture(false);
    const authority = new AuthorityManager({ homeDir: base, commands: ["node"], terminalEnabled: false });
    const lease = await authority.start({ profile: "project", projectRoots: [root] });
    const scoped = createScopedRuntime({ config, audit: new AuditLogger(config.auditFile) }, authority.resolve(lease.leaseId));

    await expect(scoped.process.run("node", ["--version"], root)).rejects.toBeInstanceOf(PolicyError);
  });

  it("enables allowlisted terminal through a project lease when the runtime gate is enabled", async () => {
    const { base, root, config } = await fixture(true);
    const authority = new AuthorityManager({ homeDir: base, commands: ["node"], terminalEnabled: true });
    // Serbest mod: tek profil project'tir; kabiliyet startup kapısına bağlıdır.
    const lease = await authority.start({ profile: "project", projectRoots: [root] });
    const scoped = createScopedRuntime({ config, audit: new AuditLogger(config.auditFile) }, authority.resolve(lease.leaseId));

    await expect(scoped.process.run("sh", ["-c", "echo nope"], root)).rejects.toBeInstanceOf(PolicyError);

    const result = await scoped.process.run("node", ["--version"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+/);
  });
  it("returns promptly when a timed out command leaves a grandchild holding the output pipes", async () => {
    const { root, service } = await fixture(true);
    const startedMarker = path.join(root, "grandchild-started");
    const survivedMarker = path.join(root, "grandchild-survived");
    const childScript = path.join(root, "grandchild.cjs");
    const parentScript = path.join(root, "parent.cjs");
    // Torun, ebeveynin stdout borusunu miras alır. Timeout yalnızca doğrudan
    // çocuğu öldürürse boru açık kalır ve çağrı hosted yanıt süresini aşacak
    // kadar asılı kalır.
    await writeFile(childScript, [
      `require("node:fs").writeFileSync(${JSON.stringify(startedMarker)}, "x");`,
      `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(survivedMarker)}, "x"), 6000);`,
    ].join("\n"), "utf8");
    await writeFile(parentScript, [
      'require("node:child_process").spawn(process.execPath, [' + JSON.stringify(childScript) + '], { stdio: "inherit" });',
      "setTimeout(() => {}, 30000);",
    ].join("\n"), "utf8");

    const startedAt = Date.now();
    await expect(service.run("node", [parentScript], root)).rejects.toBeInstanceOf(CommandTimeoutError);
    expect(Date.now() - startedAt).toBeLessThan(4_000);

    await expect(access(startedMarker)).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 7_000));
    await expect(access(survivedMarker)).rejects.toThrow();
  }, 15_000);
});
