import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
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

type BackendMode = "pass" | "fail" | "mutate";

class VerificationBackend implements ProjectExecBackend {
  readonly requests: ProjectExecRequest[] = [];
  mode: BackendMode = "pass";

  async run(request: ProjectExecRequest): Promise<ProjectExecResult> {
    this.requests.push(request);
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
    status: "PASS" | "FAIL" | "NOT_RUN" | "STALE" | "UNAVAILABLE";
    evidence?: {
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
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { leaseId: string }).leaseId;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(projectExecEnabled = true) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-project-check-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  const taskStateRoot = path.join(base, "home", ".chatgpt-system", "state");
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: "verification-fixture",
    private: true,
    scripts: {
      check: "npm run build && npm test",
      build: "tsc -p tsconfig.json",
      test: "vitest run",
    },
  }, null, 2)}\n`, "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "project-check@example.invalid"]);
  git(root, ["config", "user.name", "Project Check Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);

  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "npm", "git"] },
    projectExec: { enabled: projectExecEnabled },
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
    http: { host: "127.0.0.1", port: 0, token: "project-check-token-0123456789" },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 2_000,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 2_000,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  };

  const backend = new VerificationBackend();
  const runtime = createRuntimeServices(config, { taskStateRoot, projectExecBackend: backend });
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
  return { base, root, taskStateRoot, config, backend, runtime, server, client, transport };
}

describe("project_check MCP tool", () => {
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
  });

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
  });
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
