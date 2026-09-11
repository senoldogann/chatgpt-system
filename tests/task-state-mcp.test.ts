import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

interface CheckpointView {
  revision: number;
  summary: string;
  findings: string[];
  decisions: string[];
  inspectedFiles: string[];
  modifiedFiles: string[];
  nextStep?: string;
  evidenceRefs: string[];
  head: string;
  workingTreeDigest: string;
  createdAt: string;
}

interface TaskStateView {
  taskId: string;
  status: "active" | "completed" | "failed";
  revision: number;
  goal: string;
  repositoryRoot: string;
  projectFingerprint: string;
  baseHead: string;
  currentHead: string;
  workingTreeDigest: string;
  checkpointCount: number;
  checkpoints: CheckpointView[];
  outcome?: {
    status: "completed" | "failed";
    summary: string;
    evidenceRefs: string[];
    head: string;
    workingTreeDigest: string;
    createdAt: string;
  };
  observed: {
    head: string;
    workingTreeDigest: string;
  };
  freshness: {
    fresh: boolean;
    headMatches: boolean;
    workingTreeMatches: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

async function stopRuntime(server: ReturnType<typeof startHttp>, runtime: RuntimeServices): Promise<void> {
  const serverIndex = servers.indexOf(server);
  if (serverIndex >= 0) servers.splice(serverIndex, 1);
  const runtimeIndex = runtimes.indexOf(runtime);
  if (runtimeIndex >= 0) runtimes.splice(runtimeIndex, 1);
  if (server.listening) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await runtime.processSupervisor.close();
}

async function connectRuntime(config: AppConfig, taskStateRoot: string) {
  const runtime = createRuntimeServices(config, { taskStateRoot } as never);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "task-state-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${config.http.token!}` } },
  });
  await client.connect(transport);
  return { runtime, server, client, transport };
}

async function projectLease(client: Client, root: string): Promise<string> {
  const result = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(result.isError).not.toBe(true);
  return (result.structuredContent as { leaseId: string }).leaseId;
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-task-state-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  const home = path.join(base, "home");
  const taskStateRoot = path.join(home, ".chatgpt-system", "state");
  const continuity = path.join(home, ".chatgpt-system", "continuity");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(continuity, { recursive: true });
  await writeFile(path.join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
  await writeFile(path.join(continuity, "sentinel.txt"), "continuity-owned\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "task-state@example.invalid"]);
  git(root, ["config", "user.name", "Task State Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);

  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    projectExec: { enabled: false },
    personalAdmin: { enabled: true },
    computerUse: {
      enabled: false,
      fullHostJsEnabled: false,
      hostBundlePath: path.join(base, "ChatGPTSystemComputerRuntime.app"),
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
    browser: {
      enabled: false,
      headless: true,
      timeoutMs: 1_000,
      userDataDir: path.join(base, "browser-profile"),
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, token: "task-state-token-0123456789" },
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
  return { base, root, taskStateRoot, continuity, config };
}

describe("task_state MCP tool", () => {
  it("persists redacted project task state across runtime restart and reports freshness from HEAD/worktree state", async () => {
    const { root, taskStateRoot, continuity, config } = await fixture();
    const firstRuntime = await connectRuntime(config, taskStateRoot);
    let taskId: string;
    try {
      const { tools } = await firstRuntime.client.listTools();
      const tool = tools.find((item) => item.name === "task_state");
      expect(tool).toBeDefined();
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });

      const leaseId = await projectLease(firstRuntime.client, root);
      const started = await firstRuntime.client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "start",
          cwd: root,
          goal: "Implement durable state API_KEY=super-secret-value Bearer very-secret-bearer",
          nextStep: "Inspect src/app.ts",
        },
      });
      expect(started.isError).not.toBe(true);
      const startedBody = started.structuredContent as unknown as TaskStateView;
      taskId = startedBody.taskId;
      expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
      expect(startedBody.status).toBe("active");
      expect(startedBody.revision).toBe(1);
      expect(startedBody.baseHead).toMatch(/^[a-f0-9]{40}$/);
      expect(startedBody.currentHead).toBe(startedBody.baseHead);
      expect(startedBody.workingTreeDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(startedBody.projectFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(startedBody.freshness).toEqual({ fresh: true, headMatches: true, workingTreeMatches: true });
      expect(JSON.stringify(startedBody)).not.toContain("super-secret-value");
      expect(JSON.stringify(startedBody)).not.toContain("very-secret-bearer");

      const checkpoint = await firstRuntime.client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "checkpoint",
          cwd: root,
          taskId,
          summary: "Mapped current state token=checkpoint-secret",
          findings: ["Current API is missing durable checkpoints", "password=hunter2"],
          decisions: ["Use project-scoped JSON state"],
          inspectedFiles: ["src/app.ts"],
          modifiedFiles: [],
          nextStep: "Add persistence layer",
          evidenceRefs: ["test:red:task-state"],
        },
      });
      expect(checkpoint.isError).not.toBe(true);
      const checkpointBody = checkpoint.structuredContent as unknown as TaskStateView;
      expect(checkpointBody.revision).toBe(2);
      expect(checkpointBody.checkpointCount).toBe(1);
      expect(checkpointBody.checkpoints[0]).toMatchObject({
        revision: 2,
        inspectedFiles: ["src/app.ts"],
        evidenceRefs: ["test:red:task-state"],
      });
      expect(JSON.stringify(checkpointBody)).not.toContain("checkpoint-secret");
      expect(JSON.stringify(checkpointBody)).not.toContain("hunter2");

      const projects = await readdir(path.join(taskStateRoot, "projects"));
      expect(projects).toEqual([checkpointBody.projectFingerprint]);
      const persistedPath = path.join(
        taskStateRoot,
        "projects",
        checkpointBody.projectFingerprint,
        "tasks",
        `${taskId}.json`,
      );
      const persisted = await readFile(persistedPath, "utf8");
      expect((await stat(persistedPath)).mode & 0o777).toBe(0o600);
      expect(persisted).not.toContain("super-secret-value");
      expect(persisted).not.toContain("very-secret-bearer");
      expect(persisted).not.toContain("checkpoint-secret");
      expect(persisted).not.toContain("hunter2");
      expect(await readFile(path.join(continuity, "sentinel.txt"), "utf8")).toBe("continuity-owned\n");
      const audit = await readFile(config.auditFile, "utf8");
      expect(audit).not.toContain(taskId);
      expect(audit).not.toContain("super-secret-value");
      expect(audit).not.toContain("very-secret-bearer");
      expect(audit).not.toContain("checkpoint-secret");
      expect(audit).not.toContain("hunter2");

      await writeFile(path.join(root, "src", "app.ts"), "export const value = 2;\n", "utf8");
      const stale = await firstRuntime.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "status", cwd: root, taskId },
      });
      expect(stale.isError).not.toBe(true);
      const staleBody = stale.structuredContent as unknown as TaskStateView;
      expect(staleBody.freshness.fresh).toBe(false);
      expect(staleBody.freshness.headMatches).toBe(true);
      expect(staleBody.freshness.workingTreeMatches).toBe(false);
      expect(staleBody.observed.workingTreeDigest).not.toBe(staleBody.workingTreeDigest);
    } finally {
      await firstRuntime.transport.terminateSession();
      await firstRuntime.client.close();
      await stopRuntime(firstRuntime.server, firstRuntime.runtime);
    }

    const secondRuntime = await connectRuntime(config, taskStateRoot);
    try {
      const leaseId = await projectLease(secondRuntime.client, root);
      const resumed = await secondRuntime.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "status", cwd: root, taskId: taskId! },
      });
      expect(resumed.isError).not.toBe(true);
      const resumedBody = resumed.structuredContent as unknown as TaskStateView;
      expect(resumedBody.revision).toBe(2);
      expect(resumedBody.checkpointCount).toBe(1);
      expect(resumedBody.freshness.fresh).toBe(false);

      const refreshed = await secondRuntime.client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "checkpoint",
          cwd: root,
          taskId: taskId!,
          summary: "Accepted current dirty working tree",
          findings: [],
          decisions: [],
          inspectedFiles: ["src/app.ts"],
          modifiedFiles: ["src/app.ts"],
          nextStep: "Run verification",
          evidenceRefs: [],
        },
      });
      expect(refreshed.isError).not.toBe(true);
      expect((refreshed.structuredContent as unknown as TaskStateView).freshness.fresh).toBe(true);

      const completed = await secondRuntime.client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "complete",
          cwd: root,
          taskId: taskId!,
          summary: "Task complete",
          evidenceRefs: ["verification:pending-task5"],
        },
      });
      expect(completed.isError).not.toBe(true);
      const completedBody = completed.structuredContent as unknown as TaskStateView;
      expect(completedBody.status).toBe("completed");
      expect(completedBody.revision).toBe(4);
      expect(completedBody.outcome).toMatchObject({
        status: "completed",
        summary: "Task complete",
        evidenceRefs: ["verification:pending-task5"],
      });
      expect(completedBody.freshness.fresh).toBe(true);

      const illegal = await secondRuntime.client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "checkpoint",
          cwd: root,
          taskId: taskId!,
          summary: "must fail",
        },
      });
      expect(illegal.isError).toBe(true);
      expect(resultText(illegal)).toContain("CONFLICT");
    } finally {
      await secondRuntime.transport.terminateSession();
      await secondRuntime.client.close();
    }
  });

  it("restricts durable task state to Project authority and supports explicit failure terminal state", async () => {
    const { root, taskStateRoot, config } = await fixture();
    const connected = await connectRuntime(config, taskStateRoot);
    try {
      const admin = await connected.client.callTool({
        name: "session_authority_start",
        arguments: { profile: "admin", requestedTtlSeconds: 120 },
      });
      expect(admin.isError).not.toBe(true);
      const adminLeaseId = (admin.structuredContent as { leaseId: string }).leaseId;
      const denied = await connected.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: adminLeaseId, operation: "start", cwd: root, goal: "should fail" },
      });
      expect(denied.isError).toBe(true);
      expect(resultText(denied)).toContain("AUTHORITY_DENIED");

      const leaseId = await projectLease(connected.client, root);
      const started = await connected.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "start", cwd: root, goal: "Failing task" },
      });
      const taskId = (started.structuredContent as unknown as TaskStateView).taskId;
      await writeFile(path.join(root, "src", "app.ts"), "export const value = 3;\n", "utf8");
      git(root, ["add", "src/app.ts"]);
      git(root, ["commit", "-q", "-m", "advance head"]);
      const headStale = await connected.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "status", cwd: root, taskId },
      });
      expect(headStale.isError).not.toBe(true);
      const headStaleBody = headStale.structuredContent as unknown as TaskStateView;
      expect(headStaleBody.freshness).toEqual({ fresh: false, headMatches: false, workingTreeMatches: true });

      const failed = await connected.client.callTool({
        name: "task_state",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "fail",
          cwd: root,
          taskId,
          summary: "Blocked by unavailable dependency",
          evidenceRefs: [],
        },
      });
      expect(failed.isError).not.toBe(true);
      const failedBody = failed.structuredContent as unknown as TaskStateView;
      expect(failedBody.status).toBe("failed");
      expect(failedBody.revision).toBe(2);
      expect(failedBody.outcome?.status).toBe("failed");
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });
  it("fails closed on corrupt durable state and rejects a revoked Project lease", async () => {
    const { root, taskStateRoot, config } = await fixture();
    const connected = await connectRuntime(config, taskStateRoot);
    try {
      const leaseId = await projectLease(connected.client, root);
      const started = await connected.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "start", cwd: root, goal: "Recovery fixture" },
      });
      expect(started.isError).not.toBe(true);
      const body = started.structuredContent as unknown as TaskStateView;
      const persistedPath = path.join(
        taskStateRoot,
        "projects",
        body.projectFingerprint,
        "tasks",
        `${body.taskId}.json`,
      );
      await writeFile(persistedPath, "{corrupt-state-secret=must-not-leak", "utf8");

      const corrupt = await connected.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "status", cwd: root, taskId: body.taskId },
      });
      expect(corrupt.isError).toBe(true);
      expect(resultText(corrupt)).toContain("RECOVERY_REQUIRED");
      expect(resultText(corrupt)).not.toContain("must-not-leak");

      const ended = await connected.client.callTool({
        name: "session_authority_end",
        arguments: { authorityLeaseId: leaseId },
      });
      expect(ended.isError).not.toBe(true);
      const staleAuthority = await connected.client.callTool({
        name: "task_state",
        arguments: { authorityLeaseId: leaseId, operation: "status", cwd: root, taskId: body.taskId },
      });
      expect(staleAuthority.isError).toBe(true);
      expect(resultText(staleAuthority)).toContain("AUTHORITY_REQUIRED");
    } finally {
      await connected.transport.terminateSession();
      await connected.client.close();
    }
  });

});
