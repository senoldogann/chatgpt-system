import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
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

interface LeasedClient {
  client: Client;
  authorityLeaseId: string;
}

async function tempBase(): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-git-authority-"));
  cleanups.push(base);
  return base;
}

async function leasedClient(base: string, root: string): Promise<LeasedClient> {
  const token = "git-authority-boundary-token-0123456789";
  const config = await loadConfig({
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminalEnabled: false,
    projectExecEnabled: false,
    personalAdminEnabled: false,
    computerUseEnabled: false,
    fullHostJsEnabled: false,
    browserEnabled: false,
    controlEnabled: false,
    continuityDatabasePath: path.join(base, "continuity.db"),
    controlSocketPath: path.join(base, "control.sock"),
    host: "127.0.0.1",
    port: 0,
    token,
  });
  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "git-authority-boundary-test", version: "1.0.0" });
  clients.push(client);
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  const started = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(started.isError).not.toBe(true);
  return { client, authorityLeaseId: (started.structuredContent as { leaseId: string }).leaseId };
}

function initRepository(repository: string): void {
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.name", "Git Authority Test"]);
  git(repository, ["config", "user.email", "git-authority@example.invalid"]);
}

describe("git authority boundary", () => {
  it("refuses git mutations when repository config can run external commands", async () => {
    const base = await tempBase();
    const root = path.join(base, "project");
    await mkdir(root);
    initRepository(root);
    const marker = path.join(base, "filter-clean-executed");
    const { client, authorityLeaseId } = await leasedClient(base, root);

    const configRead = await client.callTool({
      name: "fs_read",
      arguments: { authorityLeaseId, path: ".git/config" },
    });
    expect(configRead.isError).not.toBe(true);
    const currentConfig = configRead.structuredContent as unknown as { content: string; sha256: string };

    const configWrite = await client.callTool({
      name: "fs_write",
      arguments: {
        authorityLeaseId,
        path: ".git/config",
        content: `${currentConfig.content}\n[filter "boundary"]\n\tclean = "touch ${marker}; cat"\n\trequired = true\n`,
        expectedSha256: currentConfig.sha256,
      },
    });
    expect(configWrite.isError).not.toBe(true);

    const attributesWrite = await client.callTool({
      name: "fs_write",
      arguments: { authorityLeaseId, path: ".gitattributes", content: "*.txt filter=boundary\n" },
    });
    expect(attributesWrite.isError).not.toBe(true);

    const fixtureWrite = await client.callTool({
      name: "fs_write",
      arguments: { authorityLeaseId, path: "fixture.txt", content: "boundary probe\n" },
    });
    expect(fixtureWrite.isError).not.toBe(true);

    const staged = await client.callTool({
      name: "git_stage_paths",
      arguments: { authorityLeaseId, cwd: ".", paths: ["fixture.txt"] },
    });
    expect(staged.isError).toBe(true);
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });

    const status = await client.callTool({
      name: "git_status",
      arguments: { authorityLeaseId, cwd: "." },
    });
    expect(status.isError).toBe(true);
  });

  it("refuses git reads when the repository root escapes the authority root", async () => {
    const base = await tempBase();
    const root = path.join(base, "allowed");
    await mkdir(root);
    initRepository(base);
    await writeFile(path.join(base, "outside.txt"), "before\n", "utf8");
    await writeFile(path.join(root, "inside.txt"), "inside\n", "utf8");
    git(base, ["add", "."]);
    git(base, ["commit", "-q", "-m", "initial"]);
    await writeFile(path.join(base, "outside.txt"), "OUTSIDE_AUTHORITY_CANARY\n", "utf8");

    const { client, authorityLeaseId } = await leasedClient(base, root);
    const diff = await client.callTool({
      name: "git_diff",
      arguments: { authorityLeaseId, cwd: "." },
    });

    expect(diff.isError).toBe(true);
    expect(JSON.stringify(diff)).not.toContain("OUTSIDE_AUTHORITY_CANARY");
  });

  it("treats staged paths literally instead of expanding pathspec magic", async () => {
    const base = await tempBase();
    const root = path.join(base, "project");
    await mkdir(root);
    initRepository(root);
    await writeFile(path.join(root, "README.md"), "base\n", "utf8");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-q", "-m", "base"]);
    await writeFile(path.join(root, "keep.txt"), "keep\n", "utf8");
    await writeFile(path.join(root, "secret.txt"), "secret\n", "utf8");

    const { client, authorityLeaseId } = await leasedClient(base, root);
    const staged = await client.callTool({
      name: "git_stage_paths",
      arguments: { authorityLeaseId, cwd: ".", paths: [":(glob)*.txt"] },
    });

    const stagedResult = staged.structuredContent as unknown as { exitCode: number } | undefined;
    expect(staged.isError === true || stagedResult?.exitCode !== 0).toBe(true);
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });
});
