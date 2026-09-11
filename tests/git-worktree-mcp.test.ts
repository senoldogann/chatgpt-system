import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

interface WorktreeView {
  operation: "create" | "status" | "remove";
  worktreeId: string;
  path: string;
  repositoryRoot: string;
  branch: string;
  head: string;
  dirty: boolean;
  removed: boolean;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-worktree-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  const stateRoot = path.join(base, "home", ".chatgpt-system", "state");
  const worktreeRoot = path.join(base, "home", ".chatgpt-system", "worktrees");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "README.md"), "base\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "worktree@example.invalid"]);
  git(root, ["config", "user.name", "Worktree Test"]);
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-q", "-m", "base"]);

  const token = "worktree-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    projectExec: { enabled: false },
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
    http: { host: "127.0.0.1", port: 0, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 2_000,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 3_000,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  };

  const runtime = createRuntimeServices(config, { taskStateRoot: stateRoot, worktreeRoot });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "git-worktree-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  const started = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(started.isError).not.toBe(true);
  return {
    base,
    root,
    stateRoot,
    worktreeRoot,
    client,
    transport,
    authorityLeaseId: (started.structuredContent as { leaseId: string }).leaseId,
  };
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("git_worktree MCP tool", () => {
  it("creates, persists, inspects, and cleanly removes only plugin-owned worktrees", async () => {
    const { root, stateRoot, worktreeRoot, client, transport, authorityLeaseId } = await fixture();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "git_worktree");
      expect(tool).toBeDefined();
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });

      const created = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "create", cwd: root, branch: "agent/task-one" },
      });
      expect(created.isError).not.toBe(true);
      const createdBody = created.structuredContent as unknown as WorktreeView;
      expect(createdBody).toMatchObject({
        operation: "create",
        branch: "agent/task-one",
        dirty: false,
        removed: false,
      });
      expect(createdBody.worktreeId).toMatch(/^[0-9a-f-]{36}$/);
      expect(createdBody.path.startsWith(worktreeRoot + path.sep)).toBe(true);
      expect(await readFile(path.join(createdBody.path, "README.md"), "utf8")).toBe("base\n");
      expect(git(createdBody.path, ["branch", "--show-current"])).toBe("agent/task-one");

      const registry = path.join(stateRoot, "managed-worktrees", `${createdBody.worktreeId}.json`);
      expect((await stat(registry)).mode & 0o777).toBe(0o600);

      const status = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "status", worktreeId: createdBody.worktreeId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({
        operation: "status",
        worktreeId: createdBody.worktreeId,
        branch: "agent/task-one",
        dirty: false,
        removed: false,
      });

      await writeFile(path.join(createdBody.path, "README.md"), "dirty\n", "utf8");
      const dirtyRemove = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "remove", worktreeId: createdBody.worktreeId },
      });
      expect(dirtyRemove.isError).toBe(true);
      expect(textResult(dirtyRemove)).toContain("WORKTREE_DIRTY");
      expect(await readFile(path.join(createdBody.path, "README.md"), "utf8")).toBe("dirty\n");

      await writeFile(path.join(createdBody.path, "README.md"), "base\n", "utf8");
      const removed = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "remove", worktreeId: createdBody.worktreeId },
      });
      expect(removed.isError).not.toBe(true);
      expect(removed.structuredContent).toMatchObject({
        operation: "remove",
        worktreeId: createdBody.worktreeId,
        branch: "agent/task-one",
        dirty: false,
        removed: true,
      });
      await expect(stat(createdBody.path)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(registry)).rejects.toMatchObject({ code: "ENOENT" });
      expect(git(root, ["show-ref", "--verify", "refs/heads/agent/task-one"])).toContain("refs/heads/agent/task-one");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("rejects dirty sources, invalid branches, unmanaged paths, and non-Project authority", async () => {
    const { base, root, stateRoot, client, transport, authorityLeaseId } = await fixture();
    try {
      await writeFile(path.join(root, "README.md"), "dirty source\n", "utf8");
      const dirtySource = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "create", cwd: root, branch: "agent/dirty-source" },
      });
      expect(dirtySource.isError).toBe(true);
      expect(textResult(dirtySource)).toContain("WORKTREE_DIRTY");
      await writeFile(path.join(root, "README.md"), "base\n", "utf8");

      const invalidBranch = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "create", cwd: root, branch: "../escape" },
      });
      expect(invalidBranch.isError).toBe(true);
      expect(textResult(invalidBranch)).toContain("POLICY_DENIED");

      const unmanaged = path.join(base, "manual-worktree");
      git(root, ["worktree", "add", "-q", "-b", "manual/unmanaged", unmanaged, "HEAD"]);
      const pathInjection = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "remove", worktreeId: "00000000-0000-4000-8000-000000000000", path: unmanaged },
      });
      expect(pathInjection.isError).toBe(true);
      expect(await readFile(path.join(unmanaged, "README.md"), "utf8")).toBe("base\n");

      const managed = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "create", cwd: root, branch: "agent/tamper-check" },
      });
      expect(managed.isError).not.toBe(true);
      const managedBody = managed.structuredContent as unknown as WorktreeView;
      const registry = path.join(stateRoot, "managed-worktrees", `${managedBody.worktreeId}.json`);
      const record = JSON.parse(await readFile(registry, "utf8")) as Record<string, unknown>;
      record.path = unmanaged;
      await writeFile(registry, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      const tamperedRemove = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId, operation: "remove", worktreeId: managedBody.worktreeId },
      });
      expect(tamperedRemove.isError).toBe(true);
      expect(textResult(tamperedRemove)).toContain("RECOVERY_REQUIRED");
      expect(await readFile(path.join(unmanaged, "README.md"), "utf8")).toBe("base\n");
      expect(await readFile(path.join(managedBody.path, "README.md"), "utf8")).toBe("base\n");

      const adminStart = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "admin", requestedTtlSeconds: 60 },
      });
      expect(adminStart.isError).not.toBe(true);
      const adminLeaseId = (adminStart.structuredContent as { leaseId: string }).leaseId;
      const adminAttempt = await client.callTool({
        name: "git_worktree",
        arguments: { authorityLeaseId: adminLeaseId, operation: "status", worktreeId: managedBody.worktreeId },
      });
      expect(adminAttempt.isError).toBe(true);
      expect(textResult(adminAttempt)).toContain("AUTHORITY_DENIED");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
