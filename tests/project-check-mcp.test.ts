import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { ContinuityResumeContext } from "../src/continuity-resume-registry.js";
import { createProjectCheckService } from "../src/project-check-factory.js";
import { ProjectPublishGate } from "../src/project-publish-gate.js";
import { CommandTimeoutError, ExecutableNotFoundError, SandboxUnavailableError } from "../src/errors.js";
import type {
  ProjectCheckCommandResult,
  ProjectCheckExecutor,
} from "../src/project-check-types.js";
import type {
  ProjectExecBackend,
  ProjectExecRequest,
  ProjectExecResult,
} from "../src/project-exec-types.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

type BackendMode = "pass" | "fail" | "mutate" | "unavailable";
type HostMode = "pass" | "fail" | "mutate" | "unavailable" | "timeout";

class HostVerificationExecutor implements ProjectCheckExecutor {
  readonly requests: Array<{ command: string; args: string[]; cwd: string; timeoutMs: number }> = [];
  mode: HostMode = "pass";

  constructor(private readonly projectRoot: string) {}

  async run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProjectCheckCommandResult> {
    this.requests.push({ command, args: [...args], cwd, timeoutMs });
    if (this.mode === "unavailable") throw new ExecutableNotFoundError(command);
    if (this.mode === "timeout") throw new CommandTimeoutError(timeoutMs, { command });
    if (this.mode === "mutate") {
      await writeFile(path.join(this.projectRoot, "during-native-check.txt"), "changed\n", "utf8");
    }
    return {
      command,
      args: [...args],
      cwd,
      exitCode: this.mode === "fail" ? 2 : 0,
      signal: null,
      stdout: "TOKEN=native-secret\nnative output\n",
      stderr: this.mode === "fail" ? "password=native-error\n" : "",
      timedOut: false,
    };
  }
}

class VerificationBackend implements ProjectExecBackend {
  readonly requests: ProjectExecRequest[] = [];
  mode: BackendMode = "pass";

  async run(request: ProjectExecRequest): Promise<ProjectExecResult> {
    this.requests.push(request);
    if (this.mode === "unavailable") throw new SandboxUnavailableError("docker_unavailable");
    if (this.mode === "mutate") {
      await writeFile(path.join(request.projectRoot, "src", "during-check.ts"), "export const changed = true;\n", "utf8");
    }
    return {
      command: request.command,
      args: [...request.args],
      cwd: request.cwd,
      exitCode: this.mode === "fail" ? 2 : 0,
      signal: null,
      stdout: "API_KEY=verification-secret\nsandbox output\n",
      stderr: this.mode === "fail" ? "password=should-not-persist\n" : "",
      timedOut: false,
      sandbox: { backend: "docker", network: "none", hostFallback: false },
    };
  }
}

interface ProjectCheckView {
  operation: "detect" | "run" | "report";
  repositoryRoot: string;
  required: boolean;
  overallStatus: "PASS" | "FAIL" | "NOT_RUN" | "STALE" | "UNAVAILABLE";
  observed: { head: string; workingTreeDigest: string };
  checks: Array<{
    checkId: string;
    kind: string;
    command: string;
    args: string[];
    cwd: string;
    source: string;
    execution: "project-sandbox" | "admin-host";
    status: "PASS" | "FAIL" | "NOT_RUN" | "STALE" | "UNAVAILABLE";
    evidence?: {
      execution?: "project-sandbox" | "admin-host";
      baseStatus: "PASS" | "FAIL" | "UNAVAILABLE";
      stdoutSha256: string;
      stderrSha256: string;
      stdoutBytes: number;
      stderrBytes: number;
      stateChangedDuringRun: boolean;
    };
  }>;
}

interface TaskStateView {
  taskId: string;
  status: "active" | "completed" | "failed";
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function projectLease(client: Client, root: string): Promise<string> {
  const result = await client.callTool({
    name: "session_authority_start",
    arguments: { projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { leaseId: string }).leaseId;
}

function resumedContext(canonicalWorktree: string): ContinuityResumeContext {
  return {
    projectId: "project-1",
    alias: "Project-X",
    recordVersion: 4,
    canonicalWorktree,
    repositoryRoot: canonicalWorktree,
    repositoryIdentity: "c".repeat(64),
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

// Tekli proje kipi: yerel şerit için ayrı Admin lease gerekmez.
async function nativeLaneLease(client: Client, root: string): Promise<string> {
  return projectLease(client, root);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

type FixtureKind = "node" | "swiftpm" | "mixed";

async function fixture(projectExecEnabled = true, kind: FixtureKind = "node") {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-project-check-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  const taskStateRoot = path.join(base, "home", ".chatgpt-system", "state");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
  if (kind === "node" || kind === "mixed") {
    await writeFile(path.join(root, "package.json"), `${JSON.stringify({
      name: "verification-fixture",
      private: true,
      scripts: {
        check: "npm run build && npm test",
        build: "tsc -p tsconfig.json",
        test: "vitest run",
        ...(kind === "mixed" ? { "test:macos": "swift test" } : {}),
      },
    }, null, 2)}\n`, "utf8");
  }
  if (kind === "swiftpm" || kind === "mixed") {
    await writeFile(
      path.join(root, "Package.swift"),
      "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"Fixture\")\n",
      "utf8",
    );
  }
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "project-check@example.invalid"]);
  git(root, ["config", "user.name", "Project Check Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);

  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands: ["node", "npm", "git", "swift"] },
    projectExec: { enabled: projectExecEnabled },
    skills: { enabled: true, directory: path.join(base, "skills") },
    goal: { enabled: true, maxTranscriptChars: 120_000 },
    workers: { enabled: true, maxWorkers: 8, maxParkedRuns: 16 },
    continuity: {
      databasePath: path.join(path.dirname(path.join(base, "audit.jsonl")), "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },

    personalAdmin: { enabled: true },
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
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    browser: { enabled: false, headless: true, timeoutMs: 1_000, userDataDir: path.join(base, "browser") },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, allowNonLoopback: false, token: "project-check-token-0123456789" },
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
  };

  const backend = new VerificationBackend();
  const host = new HostVerificationExecutor(root);
  const boundRoots: string[] = [];
  const runtime = createRuntimeServices(config, {
    taskStateRoot,
    projectExecBackend: backend,
    projectCheckHostExecutorFactory: (_authority, repositoryRoot) => {
      boundRoots.push(repositoryRoot);
      return host;
    },
  });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "project-check-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${config.http.token!}` } },
  });
  await client.connect(transport);
  return { base, root, taskStateRoot, config, backend, host, boundRoots, runtime, server, client, transport };
}

async function verificationStorePath(taskStateRoot: string): Promise<string> {
  const projects = await readdir(path.join(taskStateRoot, "projects"));
  expect(projects).toHaveLength(1);
  return path.join(taskStateRoot, "projects", projects[0]!, "verification", "latest.json");
}

describe("project_check MCP tool", () => {
  it("detects fixed native checks for a pure SwiftPM repository", async () => {
    const connected = await fixture(true, "swiftpm");
    try {
      const leaseId = await projectLease(connected.client, connected.root);
      const detected = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "detect", cwd: connected.root },
      });
      expect(detected.isError).not.toBe(true);
      const body = detected.structuredContent as unknown as ProjectCheckView;
      expect(body.required).toBe(true);
      expect(body.overallStatus).toBe("NOT_RUN");
      expect(body.checks).toEqual([
        expect.objectContaining({
          checkId: "swiftpm:test",
          kind: "test",
          command: "swift",
          args: ["test", "--quiet"],
          source: "Package.swift",
          execution: "admin-host",
          status: "NOT_RUN",
        }),
        expect.objectContaining({
          checkId: "swiftpm:build",
          kind: "build",
          command: "swift",
          args: ["build"],
          source: "Package.swift",
          execution: "admin-host",
          status: "NOT_RUN",
        }),
      ]);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("keeps Node aggregate verification authoritative in a mixed repository", async () => {
    const connected = await fixture(true, "mixed");
    try {
      const leaseId = await projectLease(connected.client, connected.root);
      const detected = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "detect", cwd: connected.root },
      });
      expect(detected.isError).not.toBe(true);
      const body = detected.structuredContent as unknown as ProjectCheckView;
      expect(body.checks).toHaveLength(2);
      expect(body.checks[0]).toMatchObject({
        checkId: "package-script:check",
        execution: "project-sandbox",
      });
      expect(body.checks[1]).toMatchObject({
        checkId: "package-script:test:macos",
        command: "swift",
        args: ["test"],
        execution: "admin-host",
      });
      const defaultRun = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: connected.root },
      });
      expect(defaultRun.isError).not.toBe(true);
      expect((defaultRun.structuredContent as unknown as ProjectCheckView).overallStatus).toBe("NOT_RUN");
      expect(connected.backend.requests).toHaveLength(1);
      expect(connected.host.requests).toHaveLength(0);
      const denied = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: connected.root,
          checkIds: ["package-script:test:macos"] },
      });
      expect(denied.isError).toBe(true);
      expect(resultText(denied)).toContain("AUTHORITY_DENIED");
      // Tekli proje kipi: yerel şerit aynı proje lease ile yetkilendirilir.
      const nativeLaneId = await nativeLaneLease(connected.client, connected.root);
      const nativeRun = await connected.client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: leaseId, adminAuthorityLeaseId: nativeLaneId,
          operation: "run", cwd: connected.root,
          checkIds: ["package-script:test:macos"],
        },
      });
      expect(nativeRun.isError).not.toBe(true);
      expect((nativeRun.structuredContent as unknown as ProjectCheckView).overallStatus).toBe("PASS");
      expect(connected.host.requests).toHaveLength(1);
      expect(connected.host.requests[0]).toEqual({
        command: "swift", args: ["test"],
        cwd: await realpath(connected.root), timeoutMs: 10_000,
      });
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("refuses to publish a mixed repository until the native lane has run", async () => {
    const connected = await fixture(true, "mixed");
    try {
      git(connected.root, ["checkout", "-q", "-b", "feature/native-pending"]);
      const repositoryRoot = await realpath(connected.root);
      const projectCheck = createProjectCheckService(
        connected.runtime,
        await projectLease(connected.client, connected.root),
      );
      // The typified flow verifies first. The sandbox lane is authoritative on its own here, and the
      // declared native lane is never selected implicitly.
      const executed = await projectCheck.run(connected.root);
      expect(executed.checks.map((check) => [check.checkId, check.status])).toEqual([
        ["package-script:check", "PASS"],
        ["package-script:test:macos", "NOT_RUN"],
      ]);
      expect(executed.overallStatus).toBe("NOT_RUN");
      expect((await projectCheck.report(connected.root)).overallStatus).toBe("NOT_RUN");

      const pushes: string[] = [];
      const gate = new ProjectPublishGate({
        projectGit: connected.runtime.git,
        adminGit: {
          push: async () => {
            pushes.push("push");
            return { cwd: repositoryRoot, exitCode: 0, stdout: "", stderr: "" };
          },
        },
        projectCheck,
      });

      // A mixed repository therefore cannot be published on a sandbox-only verification pass,
      // and it must be refused on the exact status the report produced.
      await expect(gate.push({ cwd: connected.root, resumeContext: resumedContext(repositoryRoot) }))
        .rejects.toMatchObject({ code: "LOCAL_VERIFICATION_REQUIRED", details: { overallStatus: "NOT_RUN" } });
      expect(pushes).toEqual([]);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("publishes a sandbox-verified repository at the verified HEAD", async () => {
    const connected = await fixture(true, "node");
    try {
      git(connected.root, ["checkout", "-q", "-b", "feature/sandbox-verified"]);
      const repositoryRoot = await realpath(connected.root);
      const projectCheck = createProjectCheckService(
        connected.runtime,
        await projectLease(connected.client, connected.root),
      );
      await projectCheck.run(connected.root);
      const verification = await projectCheck.report(connected.root);
      expect(verification.overallStatus).toBe("PASS");

      const pushes: Array<{ cwd: string | undefined; expected: { branch: string; head: string } | undefined }> = [];
      const gate = new ProjectPublishGate({
        projectGit: connected.runtime.git,
        adminGit: {
          push: async (cwd, expected) => {
            pushes.push({ cwd, expected });
            return { cwd: repositoryRoot, exitCode: 0, stdout: "", stderr: "" };
          },
        },
        projectCheck,
      });

      await gate.push({ cwd: connected.root, resumeContext: resumedContext(repositoryRoot) });
      expect(pushes).toEqual([{
        cwd: connected.root,
        expected: { branch: "feature/sandbox-verified", head: verification.observed.head },
      }]);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("does not trust a symlinked Package.swift as verification configuration", async () => {
    const connected = await fixture(true, "swiftpm");
    try {
      const packagePath = path.join(connected.root, "Package.swift");
      const targetPath = path.join(connected.root, "Package.real.swift");
      await rm(packagePath);
      await writeFile(targetPath, "// not trusted through a symlink\n", "utf8");
      await symlink(targetPath, packagePath);

      const leaseId = await projectLease(connected.client, connected.root);
      const detected = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "detect", cwd: connected.root },
      });
      expect(detected.isError).not.toBe(true);
      const body = detected.structuredContent as unknown as ProjectCheckView;
      expect(body.required).toBe(false);
      expect(body.overallStatus).toBe("UNAVAILABLE");
      expect(body.checks).toEqual([]);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("fails closed before a SwiftPM check can reach the project sandbox", async () => {
    const connected = await fixture(true, "swiftpm");
    try {
      const leaseId = await projectLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: connected.root },
      });
      expect(run.isError).toBe(true);
      expect(resultText(run)).toContain("AUTHORITY_DENIED");
      expect(connected.backend.requests).toHaveLength(0);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("runs native verification with a Project lease in the native lane", async () => {
    const connected = await fixture(true, "swiftpm");
    try {
      const leaseId = await projectLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: leaseId,
          adminAuthorityLeaseId: leaseId,
          operation: "run",
          cwd: connected.root,
        },
      });
      // Tekli proje kipi: proje lease yerel şeridi çalıştırabilir.
      expect(run.isError).not.toBe(true);
      expect((run.structuredContent as unknown as ProjectCheckView).overallStatus).toBe("PASS");
      expect(connected.host.requests).toHaveLength(2);
      expect(connected.backend.requests).toHaveLength(0);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("runs fixed SwiftPM checks through a Project-authorized executor bound to the Project root", async () => {
    const connected = await fixture(true, "swiftpm");
    try {
      const projectLeaseId = await projectLease(connected.client, connected.root);
      const nativeLeaseId = await nativeLaneLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: projectLeaseId,
          adminAuthorityLeaseId: nativeLeaseId,
          operation: "run",
          cwd: connected.root,
          timeoutMs: 1500,
        },
      });
      expect(run.isError).not.toBe(true);
      const body = run.structuredContent as unknown as ProjectCheckView;
      expect(body.overallStatus).toBe("PASS");
      expect(body.checks.map((item) => item.status)).toEqual(["PASS", "PASS"]);
      const canonicalRoot = await realpath(connected.root);
      expect(connected.boundRoots).toEqual([canonicalRoot]);
      expect(connected.host.requests).toEqual([
        { command: "swift", args: ["test", "--quiet"], cwd: canonicalRoot, timeoutMs: 1500 },
        { command: "swift", args: ["build"], cwd: canonicalRoot, timeoutMs: 1500 },
      ]);
      expect(connected.backend.requests).toHaveLength(0);
      expect(body.checks[0]?.evidence?.execution).toBe("admin-host");
      expect(body.checks[1]?.evidence?.execution).toBe("admin-host");
      const persisted = await readFile(await verificationStorePath(connected.taskStateRoot), "utf8");
      expect(persisted).not.toContain("native-secret");
      expect(persisted).not.toContain("native output");
      expect(persisted).not.toContain("native-error");
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it.each([
    ["fail", "FAIL"],
    ["unavailable", "UNAVAILABLE"],
    ["timeout", "FAIL"],
  ] as const)("maps native host %s to %s without a tool-level error", async (mode, expectedStatus) => {
    const connected = await fixture(true, "swiftpm");
    try {
      connected.host.mode = mode;
      const projectLeaseId = await projectLease(connected.client, connected.root);
      const nativeLeaseId = await nativeLaneLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: projectLeaseId,
          adminAuthorityLeaseId: nativeLeaseId,
          operation: "run",
          cwd: connected.root,
        },
      });
      expect(run.isError).not.toBe(true);
      expect((run.structuredContent as unknown as ProjectCheckView).overallStatus).toBe(expectedStatus);
      expect(connected.backend.requests).toHaveLength(0);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("marks native evidence stale when repository state changes during execution", async () => {
    const connected = await fixture(true, "swiftpm");
    try {
      connected.host.mode = "mutate";
      const projectLeaseId = await projectLease(connected.client, connected.root);
      const nativeLeaseId = await nativeLaneLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: projectLeaseId,
          adminAuthorityLeaseId: nativeLeaseId,
          operation: "run",
          cwd: connected.root,
        },
      });
      expect(run.isError).not.toBe(true);
      const body = run.structuredContent as unknown as ProjectCheckView;
      expect(body.overallStatus).toBe("STALE");
      expect(body.checks[0]?.evidence?.stateChangedDuringRun).toBe(true);
      expect(connected.backend.requests).toHaveLength(0);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("does not fall back from an unavailable Node sandbox to native host execution", async () => {
    const connected = await fixture(true, "node");
    try {
      connected.backend.mode = "unavailable";
      const projectLeaseId = await projectLease(connected.client, connected.root);
      const nativeLeaseId = await nativeLaneLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: projectLeaseId,
          adminAuthorityLeaseId: nativeLeaseId,
          operation: "run",
          cwd: connected.root,
        },
      });
      expect(run.isError).not.toBe(true);
      expect((run.structuredContent as unknown as ProjectCheckView).overallStatus).toBe("UNAVAILABLE");
      expect(connected.host.requests).toHaveLength(0);
      expect(connected.backend.requests).toHaveLength(1);
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("reads legacy verification evidence that predates the execution lane field", async () => {
    const connected = await fixture(true, "node");
    try {
      const leaseId = await projectLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: connected.root },
      });
      expect(run.isError).not.toBe(true);
      const storePath = await verificationStorePath(connected.taskStateRoot);
      const stored = JSON.parse(await readFile(storePath, "utf8")) as {
        evidence: Record<string, { execution?: "project-sandbox" | "admin-host" }>;
      };
      delete stored.evidence["package-script:check"]?.execution;
      await writeFile(storePath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");

      const report = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "report", cwd: connected.root },
      });
      expect(report.isError).not.toBe(true);
      const body = report.structuredContent as unknown as ProjectCheckView;
      expect(body.checks[0]?.execution).toBe("project-sandbox");
      expect(body.checks[0]?.evidence?.execution).toBeUndefined();
      expect(body.overallStatus).toBe("PASS");
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

  it("detects real scripts, runs only detected checks, persists digest-only evidence, and enforces task completion", async () => {
    const { root, taskStateRoot, backend, client, transport } = await fixture(true);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "project_check");
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toMatchObject({ type: "object" });
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });

      const leaseId = await projectLease(client, root);
      const detected = await client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "detect", cwd: root },
      });
      expect(detected.isError).not.toBe(true);
      const detectedBody = detected.structuredContent as unknown as ProjectCheckView;
      expect(detectedBody.required).toBe(true);
      expect(detectedBody.overallStatus).toBe("NOT_RUN");
      expect(detectedBody.checks).toHaveLength(1);
      expect(detectedBody.checks[0]).toMatchObject({
        checkId: "package-script:check",
        kind: "check",
        command: "npm",
        args: ["run", "check"],
        source: "package.json#scripts.check",
        execution: "project-sandbox",
        status: "NOT_RUN",
      });

      const arbitrary = await client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "run",
          cwd: root,
          command: "sh",
          args: ["-c", "touch escaped"],
        },
      });
      expect(arbitrary.isError).toBe(true);
      expect(backend.requests).toHaveLength(0);

      const started = await client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "start", cwd: root, goal: "Verified task" },
      });
      expect(started.isError).not.toBe(true);
      const taskId = (started.structuredContent as unknown as TaskStateView).taskId;

      const premature = await client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "complete",
          cwd: root,
          taskId,
          summary: "should be blocked",
        },
      });
      expect(premature.isError).toBe(true);
      expect(resultText(premature)).toContain("VERIFICATION_REQUIRED");
      expect(resultText(premature)).toContain("NOT_RUN");

      const run = await client.callTool({
        name: "project_check",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "run",
          cwd: root,
          checkIds: ["package-script:check"],
          timeoutMs: 1500,
        },
      });
      expect(run.isError).not.toBe(true);
      const runBody = run.structuredContent as unknown as ProjectCheckView;
      expect(runBody.overallStatus).toBe("PASS");
      expect(runBody.checks[0]?.status).toBe("PASS");
      expect(runBody.checks[0]?.evidence).toMatchObject({
        baseStatus: "PASS",
        stateChangedDuringRun: false,
      });
      expect(runBody.checks[0]?.evidence?.stdoutSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(backend.requests).toHaveLength(1);
      expect(backend.requests[0]).toMatchObject({
        command: "npm",
        args: ["run", "check"],
        cwd: await realpath(root),
        timeoutMs: 1500,
      });

      const projects = await readdir(path.join(taskStateRoot, "projects"));
      expect(projects).toHaveLength(1);
      const evidencePath = path.join(taskStateRoot, "projects", projects[0]!, "verification", "latest.json");
      const persisted = await readFile(evidencePath, "utf8");
      expect(persisted).not.toContain("verification-secret");
      expect(persisted).not.toContain("should-not-persist");
      expect(persisted).not.toContain("sandbox output");

      const completed = await client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "complete",
          cwd: root,
          taskId,
          summary: "verified complete",
          evidenceRefs: ["project-check:package-script:check"],
        },
      });
      expect(completed.isError).not.toBe(true);
      expect((completed.structuredContent as unknown as TaskStateView).status).toBe("completed");

      await writeFile(path.join(root, "src", "app.ts"), "export const value = 2;\n", "utf8");
      const stale = await client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "report", cwd: root },
      });
      expect(stale.isError).not.toBe(true);
      const staleBody = stale.structuredContent as unknown as ProjectCheckView;
      expect(staleBody.overallStatus).toBe("STALE");
      expect(staleBody.checks[0]?.status).toBe("STALE");

      const nextTask = await client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "start", cwd: root, goal: "Requires fresh verification" },
      });
      const nextTaskId = (nextTask.structuredContent as unknown as TaskStateView).taskId;
      const staleComplete = await client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "complete",
          cwd: root,
          taskId: nextTaskId,
          summary: "must remain blocked",
        },
      });
      expect(staleComplete.isError).toBe(true);
      expect(resultText(staleComplete)).toContain("VERIFICATION_REQUIRED");
      expect(resultText(staleComplete)).toContain("STALE");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  }, 15_000);

  it("reports FAIL, STALE-during-run, and UNAVAILABLE without pretending checks passed", async () => {
    const enabled = await fixture(true);
    try {
      const leaseId = await projectLease(enabled.client, enabled.root);
      enabled.backend.mode = "fail";
      const failed = await enabled.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: enabled.root },
      });
      expect(failed.isError).not.toBe(true);
      expect((failed.structuredContent as unknown as ProjectCheckView).overallStatus).toBe("FAIL");

      enabled.backend.mode = "mutate";
      const changed = await enabled.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: enabled.root },
      });
      expect(changed.isError).not.toBe(true);
      const changedBody = changed.structuredContent as unknown as ProjectCheckView;
      expect(changedBody.overallStatus).toBe("STALE");
      expect(changedBody.checks[0]?.evidence?.stateChangedDuringRun).toBe(true);
    } finally {
      await enabled.transport.terminateSession();
      await enabled.client.close();
    }

    const disabled = await fixture(false);
    try {
      const leaseId = await projectLease(disabled.client, disabled.root);
      const unavailable = await disabled.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: disabled.root },
      });
      expect(unavailable.isError).not.toBe(true);
      const unavailableBody = unavailable.structuredContent as unknown as ProjectCheckView;
      expect(unavailableBody.overallStatus).toBe("UNAVAILABLE");
      expect(unavailableBody.checks[0]?.status).toBe("UNAVAILABLE");
      expect(disabled.backend.requests).toHaveLength(0);
    } finally {
      await disabled.transport.terminateSession();
      await disabled.client.close();
    }
  }, 15_000);
  it("fails closed when persisted verification evidence is corrupt", async () => {
    const connected = await fixture(true);
    try {
      const leaseId = await projectLease(connected.client, connected.root);
      const run = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "run", cwd: connected.root },
      });
      expect(run.isError).not.toBe(true);
      const projects = await readdir(path.join(connected.taskStateRoot, "projects"));
      expect(projects).toHaveLength(1);
      const storePath = path.join(
        connected.taskStateRoot,
        "projects",
        projects[0]!,
        "verification",
        "latest.json",
      );
      await writeFile(storePath, "{verification-secret=must-not-leak", "utf8");

      const report = await connected.client.callTool({
        name: "project_check",
        arguments: { authorityLeaseId: leaseId, operation: "report", cwd: connected.root },
      });
      expect(report.isError).toBe(true);
      expect(resultText(report)).toContain("RECOVERY_REQUIRED");
      expect(resultText(report)).not.toContain("must-not-leak");

      const audit = await readFile(connected.config.auditFile, "utf8");
      expect(audit).toContain('"errorCode":"RECOVERY_REQUIRED"');
      expect(audit).not.toContain("must-not-leak");
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

});
