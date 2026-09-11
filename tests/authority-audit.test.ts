import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AuthorityManager, type AuthorityAuditEvent } from "../src/authority.js";
import type { AppConfig } from "../src/config.js";
import { AuthorityExpiredError } from "../src/errors.js";
import { createRuntimeServices } from "../src/server.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-authority-audit-"));
  cleanups.push(base);
  const home = path.join(base, "home");
  const project = path.join(home, "project");
  await mkdir(project, { recursive: true });
  return { base, home, project };
}

describe("authority lifecycle audit", () => {
  it("emits start, end, and expiry events without raw lease ids", async () => {
    const { home, project } = await fixture();
    const events: AuthorityAuditEvent[] = [];
    let now = Date.parse("2026-09-07T20:00:00.000Z");
    const manager = new AuthorityManager({
      homeDir: home,
      commands: ["node"],
      terminalEnabled: false,
      now: () => now,
      audit: async (event) => { events.push(event); },
    });

    const endedLease = await manager.start({ profile: "project", projectRoots: [project], requestedTtlSeconds: 60 });
    manager.end(endedLease.leaseId);

    const expiringLease = await manager.start({ profile: "project", projectRoots: [project], requestedTtlSeconds: 1 });
    now += 1_001;
    expect(() => manager.resolve(expiringLease.leaseId)).toThrowError(AuthorityExpiredError);
    await manager.flushAudit();

    expect(events.map((event) => event.event)).toEqual([
      "authority.start",
      "authority.end",
      "authority.start",
      "authority.expired",
    ]);
    for (const event of events) {
      expect(event.profile).toBe("project");
      expect(event.rootCount).toBe(1);
      expect(event.scopeDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(event)).not.toContain(endedLease.leaseId);
      expect(JSON.stringify(event)).not.toContain(expiringLease.leaseId);
    }
  });

  it("persists redacted lifecycle events through the runtime audit logger", async () => {
    const { base, project } = await fixture();
    const auditFile = path.join(base, "audit.jsonl");
    const config: AppConfig = {
      roots: [project],
      auditFile,
      terminal: { enabled: false, commands: ["node"] },
      projectExec: { enabled: false },
      continuity: {
        databasePath: path.join(path.dirname(auditFile), "continuity.db"),
        maxResumeChars: 12_000,
        maxTrackedPaths: 100,
        remoteVerificationTimeoutMs: 1_000,
      },

      computerUse: {
        enabled: false,
        hostBundlePath: "/tmp/ChatGPTSystemComputerRuntime.app",
        requestTimeoutMs: 10_000,
        maxObservationElements: 500,
        maxObservationChars: 262_144,
        maxScreenshotBytes: 8_388_608,
        maxActionProgramActions: 100,
        maxActionProgramRuntimeMs: 30_000,
      },
      http: { host: "127.0.0.1", port: 4312 },
      limits: {
        maxReadBytes: 1024,
        maxWriteBytes: 1024,
        maxDirectoryEntries: 100,
        maxCommandOutputBytes: 1024,
        commandTimeoutMs: 1_000,
      },
    };
    const runtime = createRuntimeServices(config);
    const lease = await runtime.authority.start({ profile: "project", projectRoots: [project], requestedTtlSeconds: 60 });
    runtime.authority.end(lease.leaseId);
    await runtime.authority.flushAudit();

    const audit = await readFile(auditFile, "utf8");
    expect(audit).toContain('"action":"authority.start"');
    expect(audit).toContain('"action":"authority.end"');
    expect(audit).toContain('"profile":"project"');
    expect(audit).not.toContain(lease.leaseId);
  });
});
