import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityManager } from "../src/authority.js";
import { AuditLogger } from "../src/audit.js";
import type { AppConfig } from "../src/config.js";
import {
  createProjectCheckHostExecutorFactory,
  type ProjectCheckRuntimeDependencies,
} from "../src/project-check-factory.js";
import type { ProjectExecBackend } from "../src/project-exec-types.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(commands: string[]) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-native-check-"));
  cleanups.push(base);
  const home = path.join(base, "home");
  const root = path.join(base, "repo");
  const sibling = path.join(base, "outside");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(root, { recursive: true }),
    mkdir(sibling, { recursive: true }),
  ]);

  const config = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands },
    projectExec: { enabled: true },
    personalAdmin: { enabled: true },
    ownerRuntime: {
      enabled: false,
      shellPath: "/bin/zsh",
      maxScriptBytes: 262_144,
      maxTerminalSessions: 32,
      maxTerminalOutputBytes: 262_144,
      maxTerminalInputBytes: 65_536,
    },
    computerUse: {
      enabled: false,
      fullHostJsEnabled: false,
      hostBundlePath: path.join(base, "ComputerRuntime.app"),
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
      maxAutomaticRetriesPerAction: 2,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    continuity: {
      databasePath: path.join(base, "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },
    browser: {
      enabled: false,
      connectionMode: "managed" as const,
      headless: true,
      timeoutMs: 1_000,
      userDataDir: path.join(base, "browser"),
      existingChromeUserDataDir: null,
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 4312, allowNonLoopback: false },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 2_000,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 10_000,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  } satisfies AppConfig;

  const audit = new AuditLogger(config.auditFile);
  const authority = new AuthorityManager({
    homeDir: home,
    commands,
    terminalEnabled: true,
    audit: async () => undefined,
  });
  const lease = await authority.start({ profile: "admin", requestedTtlSeconds: 120 });
  const projectExecBackend: ProjectExecBackend = {
    async run() {
      throw new Error("project sandbox must not run in host executor tests");
    },
  };
  const runtime: ProjectCheckRuntimeDependencies = {
    authority,
    audit,
    config,
    projectExecBackend,
    taskStateRoot: path.join(base, "state"),
  };
  return { root, sibling, leaseId: lease.leaseId, runtime };
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown })?.code;
}

describe("native project verification host executor", () => {
  it("uses the Admin command allowlist before launching a native check", async () => {
    const connected = await fixture(["git"]);
    const factory = createProjectCheckHostExecutorFactory(connected.runtime, connected.leaseId);
    const executor = factory(connected.root);

    await expect(executor.run("swift", ["build"], connected.root, 1000)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "COMMAND_NOT_ALLOWED",
    );
  });

  it("confines native verification cwd to the Project repository root rather than Admin filesystem scope", async () => {
    const connected = await fixture(["swift"]);
    const factory = createProjectCheckHostExecutorFactory(connected.runtime, connected.leaseId);
    const executor = factory(connected.root);

    await expect(executor.run("swift", ["build"], connected.sibling, 1000)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "POLICY_DENIED",
    );
  });
});
