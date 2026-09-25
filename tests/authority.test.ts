import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AuthorityManager,
  type AuthorityContext,
} from "../src/core/authority.js";
import { AuditLogger } from "../src/core/audit.js";
import type { AppConfig } from "../src/core/config.js";
import {
  AuthorityDeniedError,
  AuthorityExpiredError,
  AuthorityRequiredError,
  PolicyError,
} from "../src/core/errors.js";
import { createScopedRuntime } from "../src/core/scoped-runtime.js";

describe("AuthorityManager", () => {
  let fixtureRoot: string;
  let home: string;
  let projectA: string;
  let projectB: string;
  let now: number;

  beforeEach(async () => {
    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-authority-"));
    home = path.join(fixtureRoot, "home");
    projectA = path.join(home, "project-a");
    projectB = path.join(home, "project-b");
    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    now = Date.parse("2026-09-07T20:00:00.000Z");
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  function manager(): AuthorityManager {
    return new AuthorityManager({
      homeDir: home,
      commands: ["git", "node"],
      terminalEnabled: true,
      now: () => now,
    });
  }

  function baseConfig(): AppConfig {
    return {
      roots: [projectA],
      auditFile: path.join(fixtureRoot, "audit.jsonl"),
      terminal: { enabled: false, commands: ["node"] },
      projectExec: { enabled: false },
      continuity: {
        databasePath: path.join(fixtureRoot, "continuity.db"),
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
        maxReadBytes: 1024 * 1024,
        maxWriteBytes: 1024 * 1024,
        maxDirectoryEntries: 100,
        maxCommandOutputBytes: 1024 * 1024,
        commandTimeoutMs: 2_000,
      },
    };
  }

  it("issues an opaque project lease and resolves immutable canonical scope", async () => {
    const authority = manager();
    const canonicalProject = await realpath(projectA);

    const lease = await authority.start({
      profile: "project",
      projectRoots: [projectA],
      requestedTtlSeconds: 60,
    });

    expect(lease.leaseId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(lease.profile).toBe("project");
    expect(lease.roots).toEqual([canonicalProject]);
    // Serbest model: terminal kabiliyeti global kapıdan gelir, profilden değil.
    expect(lease.terminalEnabled).toBe(true);
    expect(lease.commands).toEqual(["git", "node"]);

    const resolved = authority.resolve(lease.leaseId);
    expect(resolved).toMatchObject({
      profile: "project",
      roots: [canonicalProject],
      terminalEnabled: true,
      commands: ["git", "node"],
    });

    lease.roots.push(projectB);
    expect(authority.resolve(lease.leaseId).roots).toEqual([canonicalProject]);
  });

  it("clamps ttl at 8h and expires fail closed", async () => {
    const authority = manager();
    // Üst sınır aşımı 8 saate sabitlenir.
    const lease = await authority.start({ profile: "project", projectRoots: [projectA], requestedTtlSeconds: 99_999 });

    expect(Date.parse(lease.expiresAt) - Date.parse(lease.createdAt)).toBe(8 * 60 * 60 * 1000);

    now += 8 * 60 * 60 * 1000 + 1;
    expect(() => authority.resolve(lease.leaseId)).toThrowError(AuthorityExpiredError);
    expect(() => authority.status(lease.leaseId)).toThrowError(AuthorityRequiredError);
  });

  it("revokes ended leases immediately", async () => {
    const authority = manager();
    const lease = await authority.start({ profile: "project", projectRoots: [projectA] });

    expect(authority.end(lease.leaseId)).toEqual({ ended: true });
    expect(() => authority.resolve(lease.leaseId)).toThrowError(AuthorityRequiredError);
  });

  it("rejects blank or unknown lease ids", () => {
    const authority = manager();
    expect(() => authority.resolve(" ")).toThrowError(AuthorityRequiredError);
    expect(() => authority.resolve("not-a-real-lease")).toThrowError(AuthorityRequiredError);
  });

  it("rejects broad project roots including symlink aliases of home", async () => {
    const authority = manager();
    const homeAlias = path.join(fixtureRoot, "home-alias");
    await symlink(home, homeAlias, "dir");

    await expect(authority.start({ profile: "project", projectRoots: [home] })).rejects.toThrowError(AuthorityDeniedError);
    await expect(authority.start({ profile: "project", projectRoots: [homeAlias] })).rejects.toThrowError(AuthorityDeniedError);
    await expect(authority.start({ profile: "project", projectRoots: [path.parse(home).root] })).rejects.toThrowError(AuthorityDeniedError);
    await expect(authority.start({ profile: "project" })).rejects.toThrowError(AuthorityDeniedError);
  });

  it("maps project leases to explicit roots with gate-driven terminal capability", async () => {
    // Proje kapsamı yalnızca verilen köklerden kurulur.
    const authority = manager();

    const leaseA = await authority.start({ profile: "project", projectRoots: [projectA] });
    const leaseB = await authority.start({ profile: "project", projectRoots: [projectB] });

    expect(leaseA.roots).toEqual([await realpath(projectA)]);
    expect(leaseB.roots).toEqual([await realpath(projectB)]);
    expect(leaseA.terminalEnabled).toBe(true);
    expect(leaseA.commands).toEqual(["git", "node"]);
  });

  it("keeps project terminal capability behind the runtime terminal gate", async () => {
    // Kapı kapalıysa komut listesi boşalır, açıksa global liste aynen taşınır.
    const closed = new AuthorityManager({
      homeDir: home,
      commands: ["git", "node"],
      terminalEnabled: false,
      now: () => now,
    });
    const closedLease = await closed.start({ profile: "project", projectRoots: [projectA] });
    expect(closedLease.terminalEnabled).toBe(false);
    expect(closedLease.commands).toEqual([]);

    const open = new AuthorityManager({
      homeDir: home,
      commands: ["git", "node"],
      terminalEnabled: true,
      now: () => now,
    });
    const openLease = await open.start({ profile: "project", projectRoots: [projectA] });
    expect(openLease.terminalEnabled).toBe(true);
    expect(openLease.commands).toEqual(["git", "node"]);
  });

  it("keeps concurrent leases isolated", async () => {
    const authority = manager();
    const leaseA = await authority.start({ profile: "project", projectRoots: [projectA] });
    const leaseB = await authority.start({ profile: "project", projectRoots: [projectB] });

    const resolvedA: AuthorityContext = authority.resolve(leaseA.leaseId);
    const resolvedB: AuthorityContext = authority.resolve(leaseB.leaseId);

    expect(resolvedA.roots).toEqual([await realpath(projectA)]);
    expect(resolvedB.roots).toEqual([await realpath(projectB)]);
    expect(resolvedA.roots).not.toEqual(resolvedB.roots);
  });

  it("builds isolated filesystem runtimes from lease scopes", async () => {
    await writeFile(path.join(projectA, "inside.txt"), "inside\n");
    await writeFile(path.join(projectB, "outside.txt"), "outside\n");
    await writeFile(path.join(home, "user.txt"), "user\n");

    const authority = manager();
    const config = baseConfig();
    const base = { config, audit: new AuditLogger(config.auditFile) };

    // Her proje kirası yalnızca kendi kökünü görür.
    const leaseA = await authority.start({ profile: "project", projectRoots: [projectA] });
    const runtimeA = createScopedRuntime(base, authority.resolve(leaseA.leaseId));
    expect((await runtimeA.fs.read("inside.txt", "utf8")).content).toBe("inside\n");
    await expect(runtimeA.fs.read(path.join(projectB, "outside.txt"), "utf8")).rejects.toBeInstanceOf(PolicyError);
    await expect(runtimeA.fs.read(path.join(home, "user.txt"), "utf8")).rejects.toBeInstanceOf(PolicyError);

    const leaseB = await authority.start({ profile: "project", projectRoots: [projectB] });
    const runtimeB = createScopedRuntime(base, authority.resolve(leaseB.leaseId));
    expect((await runtimeB.fs.read("outside.txt", "utf8")).content).toBe("outside\n");
    await expect(runtimeB.fs.read(path.join(projectA, "inside.txt"), "utf8")).rejects.toBeInstanceOf(PolicyError);
  });

  it("defaults project ttl to 8h when omitted", async () => {
    // TTL verilmezse üst sınır uygulanır, kiralama 8 saat yaşar.
    const authority = manager();
    const lease = await authority.start({ profile: "project", projectRoots: [projectA] });
    expect(Date.parse(lease.expiresAt) - Date.parse(lease.createdAt)).toBe(8 * 60 * 60 * 1000);
  });

  it("audits authority lifecycle without logging raw lease ids", async () => {
    const config = baseConfig();
    const audit = new AuditLogger(config.auditFile);
    await writeFile(path.join(projectA, "audited.txt"), "safe\n");

    const authority = new AuthorityManager({
      homeDir: home,
      commands: ["git", "node"],
      terminalEnabled: false,
      now: () => now,
      audit: async (event) => {
        await audit.record({
          action: event.event,
          outcome: "ok",
          durationMs: 0,
          metadata: {
            profile: event.profile,
            rootCount: event.rootCount,
            scopeDigest: event.scopeDigest,
            ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
          },
        });
      },
    });

    const lease = await authority.start({ profile: "project", projectRoots: [projectA] });
    const scoped = createScopedRuntime({ config, audit }, authority.resolve(lease.leaseId));
    await scoped.fs.read("audited.txt", "utf8");
    authority.end(lease.leaseId);
    await authority.flushAudit();

    const log = await readFile(config.auditFile, "utf8");
    expect(log).not.toContain(lease.leaseId);
    expect(log).toContain('"action":"authority.start"');
    expect(log).toContain('"action":"authority.end"');
    expect(log).toContain('"profile":"project"');
    expect(log).toMatch(/"scopeDigest":"[a-f0-9]{64}"/);
    expect(log).toContain('"action":"fs.read"');
  });
});
