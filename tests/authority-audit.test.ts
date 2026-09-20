import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AuthorityManager,
  type AuthorityAuditEvent,
  type AuthorityDenialAuditEvent,
  type AuthorityLifecycleAuditEvent,
} from "../src/authority.js";
import type { AppConfig } from "../src/config.js";
import { AuthorityExpiredError, AuthorityRequiredError } from "../src/errors.js";
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

function runtimeConfig(project: string, auditFile: string): AppConfig {
return {
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
    http: { host: "127.0.0.1", port: 4312, allowNonLoopback: false },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
};
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
    const lifecycle = events.filter(
      (event): event is AuthorityLifecycleAuditEvent => event.event !== "authority.denied",
    );
    expect(lifecycle).toHaveLength(4);
    for (const event of lifecycle) {
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
    const config = runtimeConfig(project, auditFile);
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

describe("authority denial audit", () => {
  function denialManager(home: string, clock: () => number) {
    const events: AuthorityAuditEvent[] = [];
    const manager = new AuthorityManager({
      homeDir: home,
      commands: ["node"],
      terminalEnabled: false,
      now: clock,
      audit: async (event) => { events.push(event); },
    });
    const denials = (): AuthorityDenialAuditEvent[] => events.filter(
      (event): event is AuthorityDenialAuditEvent => event.event === "authority.denied",
    );
    return { manager, events, denials };
  }

  it("records blank and unknown lease denials without raw lease ids or weakened refusal", async () => {
    const { home, project } = await fixture();
    let now = Date.parse("2026-09-17T09:00:00.000Z");
    const { manager, denials } = denialManager(home, () => now);

    const lease = await manager.start({ profile: "project", projectRoots: [project], requestedTtlSeconds: 60 });
    const forged = "forged-lease-id-0123456789";

    expect(() => manager.resolve("")).toThrowError(AuthorityRequiredError);
    expect(() => manager.resolve("   ")).toThrowError(AuthorityRequiredError);
    expect(() => manager.resolve(forged)).toThrowError(AuthorityRequiredError);
    expect(() => manager.status(forged)).toThrowError(AuthorityRequiredError);
    expect(() => manager.end(forged)).toThrowError(AuthorityRequiredError);

    // Gecerli lease hala cozulur: yetki modeli degismedi.
    expect(manager.resolve(lease.leaseId).profile).toBe("project");
    await manager.flushAudit();

    expect(denials().map((denial) => denial.reason)).toEqual(["missing", "unknown"]);
    for (const denial of denials()) {
      expect(denial.deniedCount).toBeGreaterThan(0);
      expect(denial.windowStartedAt).toBe("2026-09-17T09:00:00.000Z");
      const serialized = JSON.stringify(denial);
      expect(serialized).not.toContain(lease.leaseId);
      expect(serialized).not.toContain(forged);
      expect(serialized).not.toContain(project);
    }
  });

  it("coalesces a denial flood into bounded coarse records", async () => {
    const { home } = await fixture();
    let now = Date.parse("2026-09-17T09:00:00.000Z");
    const { manager, denials } = denialManager(home, () => now);

    for (let index = 0; index < 5_000; index += 1) {
      expect(() => manager.resolve(`forged-${index}`)).toThrowError(AuthorityRequiredError);
    }
    await manager.flushAudit();

    // Pencere acilisi tek kayit birakir; 4.999 red henuz ozetlenmedi.
    expect(denials()).toHaveLength(1);
    expect(denials()[0]).toMatchObject({ reason: "unknown", deniedCount: 1 });

    now += 60_000;
    expect(() => manager.resolve("forged-final")).toThrowError(AuthorityRequiredError);
    await manager.flushAudit();

    // 5.001 red toplam 2 audit kaydi uretir ve sayimlar ayrisik toplanir.
    expect(denials()).toHaveLength(2);
    expect(denials()[1]).toMatchObject({ reason: "unknown", deniedCount: 5_000 });
    expect(denials().reduce((total, denial) => total + denial.deniedCount, 0)).toBe(5_001);
  });

  it("persists denials through the runtime audit logger as measurable errors", async () => {
    const { base, project } = await fixture();
    const auditFile = path.join(base, "audit.jsonl");
    const runtime = createRuntimeServices(runtimeConfig(project, auditFile));

    expect(() => runtime.authority.resolve("")).toThrowError(AuthorityRequiredError);
    expect(() => runtime.authority.resolve("forged-runtime-lease")).toThrowError(AuthorityRequiredError);
    await runtime.authority.flushAudit();

    const audit = await readFile(auditFile, "utf8");
    expect(audit).toContain('"action":"authority.denied"');
    expect(audit).toContain('"outcome":"error"');
    expect(audit).toContain('"errorCode":"AUTHORITY_REQUIRED"');
    expect(audit).toContain('"reason":"missing"');
    expect(audit).toContain('"reason":"unknown"');
    expect(audit).not.toContain("forged-runtime-lease");
  });
});
