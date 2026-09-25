import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { createMcpServer, createRuntimeServices, type RuntimeServices } from "../src/server.js";

const execFileAsync = promisify(execFile);
const cleanups: string[] = [];
const runtimes: RuntimeServices[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.processSupervisor.close();
    await runtime.browser.close();
  }
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function initRepository(repository: string, marker: string): Promise<void> {
  await mkdir(repository, { recursive: true });
  const git = (args: string[]) => execFileAsync("git", args, { cwd: repository, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  await git(["init", "-q", "-b", "main"]);
  await git(["config", "user.name", "Rebind Test"]);
  await git(["config", "user.email", "rebind@example.test"]);
  await writeFile(path.join(repository, "README.md"), `${marker}\n`);
  await git(["add", "README.md"]);
  await git(["commit", "-q", "-m", marker]);
}

async function fixture() {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "chatgpt-system-rebind-")));
  cleanups.push(base);
  const bootstrap = path.join(base, "bootstrap");
  await mkdir(bootstrap);
  const config = await loadConfig({
    roots: [bootstrap],
    auditFile: path.join(base, "state", "audit.jsonl"),
    continuityDatabasePath: path.join(base, "state", "continuity.db"),
  });
  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = createMcpServer(runtime);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "rebind", version: "1.0.0" });
  await client.connect(clientTransport);
  return { base, client };
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return JSON.stringify(result.content);
}

const task = {
  goal: "Keep OmniAgent moving",
  constraints: ["Preserve history"],
  successCriteria: ["Resume by alias"],
  status: "active",
  nextStep: "Run the suite",
};

describe("continuity worktree recovery", () => {
  it("explains a re-cloned worktree mismatch and rebinds the alias while keeping its record", async () => {
    const { base, client } = await fixture();
    const projects = path.join(base, "Desktop");
    const repository = path.join(projects, "OmniAgent");
    await initRepository(repository, "first clone");

    const registered = await client.callTool({
      name: "project_register",
      arguments: { alias: "OmniAgent", worktreePath: repository, projectRoots: [projects], task },
    });
    expect(registered.isError, text(registered)).not.toBe(true);

    // Aynı yolda yeniden clone: .git klasörü yeniden oluşturulur.
    await rm(repository, { recursive: true, force: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await initRepository(repository, "second clone");

    const mismatch = await client.callTool({ name: "project_resume", arguments: { alias: "OmniAgent" } });
    expect(mismatch.isError).toBe(true);
    expect(text(mismatch)).toContain("CONTINUITY_WORKTREE_MISMATCH");
    expect(text(mismatch)).toContain("project_rebind");
    expect(text(mismatch)).toContain(repository);

    const stale = await client.callTool({
      name: "project_rebind",
      arguments: { alias: "OmniAgent", worktreePath: repository, expectedRecordVersion: 99 },
    });
    expect(stale.isError).toBe(true);

    const rebound = await client.callTool({
      name: "project_rebind",
      arguments: { alias: "OmniAgent", worktreePath: repository, expectedRecordVersion: 1 },
    });
    expect(rebound.isError, text(rebound)).not.toBe(true);
    expect(rebound.structuredContent).toMatchObject({ alias: "OmniAgent", recordVersion: 1 });

    const resumed = await client.callTool({ name: "project_resume", arguments: { alias: "OmniAgent" } });
    expect(resumed.isError, text(resumed)).not.toBe(true);
    expect(text(resumed)).toContain("Keep OmniAgent moving");
  });

  it("rebinds a moved project to its new path and roots", async () => {
    const { base, client } = await fixture();
    const oldRoot = path.join(base, "Old");
    const newRoot = path.join(base, "New");
    await initRepository(path.join(oldRoot, "OmniAgent"), "moved");
    await client.callTool({
      name: "project_register",
      arguments: { alias: "Moved", worktreePath: path.join(oldRoot, "OmniAgent"), projectRoots: [oldRoot], task },
    });
    await mkdir(newRoot);
    await rename(path.join(oldRoot, "OmniAgent"), path.join(newRoot, "OmniAgent"));

    const missing = await client.callTool({ name: "project_resume", arguments: { alias: "Moved" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("project_rebind");

    const outside = await client.callTool({
      name: "project_rebind",
      arguments: { alias: "Moved", worktreePath: path.join(newRoot, "OmniAgent"), expectedRecordVersion: 1 },
    });
    expect(outside.isError).toBe(true);

    const rebound = await client.callTool({
      name: "project_rebind",
      arguments: { alias: "Moved", worktreePath: path.join(newRoot, "OmniAgent"), projectRoots: [newRoot], expectedRecordVersion: 1 },
    });
    expect(rebound.isError, text(rebound)).not.toBe(true);
    const listed = await client.callTool({ name: "project_list", arguments: {} });
    expect(text(listed)).toContain(path.join(newRoot, "OmniAgent"));
    const resumed = await client.callTool({ name: "project_resume", arguments: { alias: "Moved" } });
    expect(resumed.isError, text(resumed)).not.toBe(true);
  });
});

describe("open scope with active Project leases", () => {
  it("lets lease-less calls reach roots of an active Project lease and explains the fix otherwise", async () => {
    const { base, client } = await fixture();
    const other = path.join(base, "Desktop", "OmniAgent");
    await initRepository(other, "outside bootstrap");

    const denied = await client.callTool({ name: "git_status", arguments: { cwd: other } });
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain("session_authority_start");

    const lease = await client.callTool({ name: "session_authority_start", arguments: { projectRoots: [other] } });
    expect(lease.isError, text(lease)).not.toBe(true);

    // Model lease kimliğini göndermeyi unutsa da aktif lease kökü kullanılabilir.
    const status = await client.callTool({ name: "git_status", arguments: { cwd: other } });
    expect(status.isError, text(status)).not.toBe(true);
    const read = await client.callTool({ name: "fs_read", arguments: { path: path.join(other, "README.md") } });
    expect(read.isError, text(read)).not.toBe(true);

    const leaseId = (lease.structuredContent as { leaseId: string }).leaseId;
    await client.callTool({ name: "session_authority_end", arguments: { authorityLeaseId: leaseId } });
    const afterEnd = await client.callTool({ name: "git_status", arguments: { cwd: other } });
    expect(afterEnd.isError).toBe(true);
  });
});
