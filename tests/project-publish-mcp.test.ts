import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { ProjectCheckCommandResult, ProjectCheckExecutor } from "../src/project-check-types.js";
import type { ProjectExecBackend, ProjectExecRequest, ProjectExecResult } from "../src/project-exec-types.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];
const clients: Client[] = [];

class PassingHostExecutor implements ProjectCheckExecutor {
  readonly requests: Array<{ command: string; args: string[]; cwd: string; timeoutMs: number }> = [];

  async run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProjectCheckCommandResult> {
    this.requests.push({ command, args: [...args], cwd, timeoutMs });
    return { command, args: [...args], cwd, exitCode: 0, signal: null, stdout: "native ok\n", stderr: "", timedOut: false };
  }
}

class PassingBackend implements ProjectExecBackend {
  readonly requests: ProjectExecRequest[] = [];
  async run(request: ProjectExecRequest): Promise<ProjectExecResult> {
    this.requests.push(request);
    return {
      command: request.command, args: [...request.args], cwd: request.cwd,
      exitCode: 0, signal: null, stdout: "ok\n", stderr: "", timedOut: false,
      sandbox: { backend: "docker", network: "none", hostFallback: false },
    };
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text).join("\n");
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function initProject(root: string, marker: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: marker, private: true, scripts: { check: "node --version" },
  }, null, 2)}\n`);
  await writeFile(path.join(root, "README.md"), `${marker}\n`);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Publish Gate Test"]);
  git(root, ["config", "user.email", "publish@example.invalid"]);
  git(root, ["add", "package.json", "README.md"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  git(root, ["switch", "-q", "-c", `feat/${marker}`]);
  git(root, ["remote", "add", "origin", path.join(path.dirname(root), `${marker}-remote.git`)]);
}

async function initSwiftProject(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "Package.swift"),
    "// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name: \"NativePublishFixture\")\n",
  );
  await writeFile(path.join(root, "README.md"), "native publish fixture\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Native Publish Gate Test"]);
  git(root, ["config", "user.email", "native-publish@example.invalid"]);
  git(root, ["add", "Package.swift", "README.md"]);
  git(root, ["commit", "-q", "-m", "initial"]);
  git(root, ["switch", "-q", "-c", "feat/native-verify"]);
  git(root, ["remote", "add", "origin", path.join(path.dirname(root), "native-remote.git")]);
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-project-publish-mcp-"));
  cleanups.push(base);
  const projectA = path.join(base, "project-a");
  const projectB = path.join(base, "project-b");
  await initProject(projectA, "a");
  await initProject(projectB, "b");
  const backend = new PassingBackend();
  const config = await loadConfig({
    roots: [base],
    auditFile: path.join(base, "audit.jsonl"),
    continuityDatabasePath: path.join(base, "continuity.db"),
    terminalEnabled: false,
    projectExecEnabled: true,
    personalAdminEnabled: true,
    computerUseEnabled: false,
    fullHostJsEnabled: false,
    browserEnabled: false,
    controlEnabled: false,
    host: "127.0.0.1",
    port: 0,
    token: "project-publish-token-0123456789",
  });
  const runtime = createRuntimeServices(config, { projectExecBackend: backend, taskStateRoot: path.join(base, "state") });
  runtimes.push(runtime);
  const server = startHttp(runtime); servers.push(server); await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "project-publish-mcp-test", version: "1.0.0" }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${config.http.token!}` } },
  }));

  for (const [alias, root] of [["Project-A", projectA], ["Project-B", projectB]] as const) {
    const registered = await client.callTool({ name: "project_register", arguments: {
      alias, worktreePath: root, projectRoots: [root],
      task: { goal: `Publish ${alias}`, constraints: [], successCriteria: [], status: "active", nextStep: "Verify and publish." },
    } });
    expect(registered.isError).not.toBe(true);
  }

  const resumedA = await client.callTool({ name: "project_resume", arguments: { alias: "Project-A", requestedTtlSeconds: 120 } });
  const resumedB = await client.callTool({ name: "project_resume", arguments: { alias: "Project-B", requestedTtlSeconds: 120 } });
  expect(resumedA.isError).not.toBe(true); expect(resumedB.isError).not.toBe(true);
  const projectALeaseId = (resumedA.structuredContent as { authorityLease: { leaseId: string } }).authorityLease.leaseId;
  const projectBLeaseId = (resumedB.structuredContent as { authorityLease: { leaseId: string } }).authorityLease.leaseId;

  const checked = await client.callTool({ name: "project_check", arguments: {
    authorityLeaseId: projectALeaseId, operation: "run", cwd: projectA,
  } });
  expect(checked.isError).not.toBe(true);
  expect((checked.structuredContent as { overallStatus: string }).overallStatus).toBe("PASS");

  // Tekli proje kipi: dış lease yok, açık kapsam kullanılır.
  return { client, runtime, backend, projectA, projectB, projectALeaseId, projectBLeaseId };
}

async function nativeFixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-native-publish-mcp-"));
  cleanups.push(base);
  const projectRoot = path.join(base, "native-project");
  await initSwiftProject(projectRoot);
  const backend = new PassingBackend();
  const host = new PassingHostExecutor();
  const config = await loadConfig({
    roots: [base],
    auditFile: path.join(base, "audit.jsonl"),
    continuityDatabasePath: path.join(base, "continuity.db"),
    terminalEnabled: true,
    commands: ["git", "swift"],
    projectExecEnabled: true,
    personalAdminEnabled: true,
    computerUseEnabled: false,
    fullHostJsEnabled: false,
    browserEnabled: false,
    controlEnabled: false,
    host: "127.0.0.1",
    port: 0,
    token: "native-project-publish-token-0123456789",
  });
  const runtime = createRuntimeServices(config, {
    projectExecBackend: backend,
    taskStateRoot: path.join(base, "state"),
    projectCheckHostExecutorFactory: () => host,
  });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "native-project-publish-mcp-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${config.http.token!}` } },
  }));

  const registered = await client.callTool({ name: "project_register", arguments: {
    alias: "Native-Project",
    worktreePath: projectRoot,
    projectRoots: [projectRoot],
    task: { goal: "Publish Native-Project", constraints: [], successCriteria: [], status: "active", nextStep: "Verify and publish." },
  } });
  expect(registered.isError).not.toBe(true);

  const resumed = await client.callTool({ name: "project_resume", arguments: { alias: "Native-Project", requestedTtlSeconds: 120 } });
  expect(resumed.isError).not.toBe(true);
  const projectLeaseId = (resumed.structuredContent as { authorityLease: { leaseId: string } }).authorityLease.leaseId;

  // Tekli proje kipi: yerel doğrulama için proje lease yeterlidir.
  return { client, host, backend, projectRoot, projectLeaseId };
}

describe("git_push single project authority", () => {
  it("rejects a generic Project lease without resume context", async () => {
    const test = await fixture();
    const generic = await test.client.callTool({ name: "session_authority_start", arguments: {
      projectRoots: [test.projectA], requestedTtlSeconds: 120,
    } });
    const genericLeaseId = (generic.structuredContent as { leaseId: string }).leaseId;
    const result = await test.client.callTool({ name: "git_push", arguments: {
      projectAuthorityLeaseId: genericLeaseId, cwd: test.projectA,
    } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("PROJECT_RESUME_REQUIRED");
  }, 15_000);

  it("accepts a Project lease in the optional outer field without an Admin gate", async () => {
    const test = await fixture();
    const result = await test.client.callTool({ name: "git_push", arguments: {
      authorityLeaseId: test.projectALeaseId, projectAuthorityLeaseId: test.projectALeaseId, cwd: test.projectA,
    } });
    expect(result.isError).toBe(true);
    // Dış lease yalnızca git kapsamı verir; son sınır uzak politika kontrolüdür.
    expect(textContent(result)).toContain("credential-free GitHub origin URL");
    expect(textContent(result)).not.toContain("PROJECT_RESUME_REQUIRED");
    expect(textContent(result)).not.toContain("LOCAL_VERIFICATION");
  }, 15_000);

  it("does not let a resumed Project-A lease publish Project-B", async () => {
    const test = await fixture();
    const result = await test.client.callTool({ name: "git_push", arguments: {
      projectAuthorityLeaseId: test.projectALeaseId, cwd: test.projectB,
    } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toMatch(/POLICY_DENIED|PROJECT_RESUME_REQUIRED/);
  }, 15_000);

  it("rejects a revoked resumed lease before registry metadata can authorize publication", async () => {
    const test = await fixture();
    const ended = await test.client.callTool({ name: "session_authority_end", arguments: { authorityLeaseId: test.projectALeaseId } });
    expect(ended.isError).not.toBe(true);
    const result = await test.client.callTool({ name: "git_push", arguments: {
      projectAuthorityLeaseId: test.projectALeaseId, cwd: test.projectA,
    } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("AUTHORITY_REQUIRED");
  }, 15_000);

  it("native SwiftPM PASS reaches the unchanged final remote policy boundary", async () => {
    const test = await nativeFixture();
    const checked = await test.client.callTool({ name: "project_check", arguments: {
      authorityLeaseId: test.projectLeaseId,
      adminAuthorityLeaseId: test.projectLeaseId,
      operation: "run",
      cwd: test.projectRoot,
    } });
    expect(checked.isError).not.toBe(true);
    expect((checked.structuredContent as { overallStatus: string }).overallStatus).toBe("PASS");
    expect(test.backend.requests).toHaveLength(0);
    expect(test.host.requests.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: "swift", args: ["test", "--quiet"] },
      { command: "swift", args: ["build"] },
    ]);

    const result = await test.client.callTool({ name: "git_push", arguments: {
      projectAuthorityLeaseId: test.projectLeaseId,
      cwd: test.projectRoot,
    } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("credential-free GitHub origin URL");
    expect(textContent(result)).not.toContain("PROJECT_RESUME_REQUIRED");
    expect(textContent(result)).not.toContain("LOCAL_VERIFICATION_REQUIRED");
    expect(textContent(result)).not.toContain("LOCAL_VERIFICATION_STALE");
  }, 15_000);

  it("valid single resumed lease with fresh PASS reaches the final remote policy boundary", async () => {
    const test = await fixture();
    const result = await test.client.callTool({ name: "git_push", arguments: {
      projectAuthorityLeaseId: test.projectALeaseId, cwd: test.projectA,
    } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("credential-free GitHub origin URL");
    expect(textContent(result)).not.toContain("PROJECT_RESUME_REQUIRED");
    expect(textContent(result)).not.toContain("LOCAL_VERIFICATION");
  }, 15_000);
});
