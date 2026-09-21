import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-open-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  const outside = path.join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, "hello.txt"), "hello\n", "utf8");
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.test"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  const token = "open-scope-token-0123456789abcdef";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: true, commands: ["node"] },
    projectExec: { enabled: false },
    skills: { enabled: true, directory: path.join(base, "skills") },
    goal: { enabled: true, maxTranscriptChars: 120_000 },
    workers: { enabled: true, maxWorkers: 8, maxParkedRuns: 16 },
    ownerRuntime: {
      enabled: false,
      shellPath: "/bin/sh",
      maxScriptBytes: 262_144,
      maxTimeoutMs: 120_000,
      maxTerminalSessions: 32,
      maxTerminalOutputBytes: 262_144,
      maxTerminalInputBytes: 65_536,
    },
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
      maxAutomaticRetriesPerAction: 2,
      maxJsSourceBytes: 262_144,
      maxJsRuntimeMs: 30_000,
      maxJsOutputBytes: 1_048_576,
    },
    jevTargeting: { enabled: false, apiKey: null },
    continuity: {
      databasePath: path.join(base, "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },
    sessionEvents: { enabled: false },
    browser: {
      enabled: false,
      connectionMode: "managed",
      headless: true,
      timeoutMs: 2_000,
      userDataDir: path.join(base, "browser"),
      existingChromeUserDataDir: null,
    },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, allowNonLoopback: false, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 10_000,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  };
  const server = startHttp(createRuntimeServices(config));
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "open-scope-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, root, outside };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("open scope without any lease", () => {
  it("reads, writes, stats and lists files against bootstrap roots", async () => {
    const { client } = await fixture();
    const listed = structured(await client.callTool({ name: "fs_list", arguments: { path: "." } }));
    expect(JSON.stringify(listed)).toContain("hello.txt");

    const read = structured(await client.callTool({ name: "fs_read", arguments: { path: "hello.txt" } }));
    expect(read.sha256).toMatch(/^[a-f0-9]{64}$/);

    const written = structured(await client.callTool({
      name: "fs_write",
      arguments: { path: "new.txt", content: "new\n", encoding: "utf8" },
    }));
    expect(written.path).toBeDefined();

    const stat = structured(await client.callTool({ name: "fs_stat", arguments: { path: "new.txt" } }));
    expect(stat.type).toBe("file");
    await client.close();
  });

  it("runs git and terminal tools without a lease but stays confined", async () => {
    const { client, outside } = await fixture();
    const status = await client.callTool({ name: "git_status", arguments: { cwd: "." } });
    expect(status.isError).not.toBe(true);

    const log = await client.callTool({ name: "git_log", arguments: { cwd: ".", limit: 5 } });
    expect(log.isError).not.toBe(true);

    const run = structured(await client.callTool({
      name: "terminal_run",
      arguments: { command: "node", args: ["--version"], cwd: "." },
    }));
    expect(run.exitCode).toBe(0);

    const escaped = await client.callTool({ name: "fs_read", arguments: { path: outside } });
    expect(escaped.isError).toBe(true);
    expect(textOf(escaped)).toContain("POLICY_DENIED");
    await client.close();
  });

  it("project leases still scope reads to their own roots", async () => {
    const { client, root } = await fixture();
    const started = structured(await client.callTool({
      name: "session_authority_start",
      arguments: { profile: "project", projectRoots: [root] },
    }));
    const leaseId = started.leaseId as string;
    expect(typeof leaseId).toBe("string");

    const listed = structured(await client.callTool({
      name: "fs_list",
      arguments: { authorityLeaseId: leaseId, path: "." },
    }));
    expect(JSON.stringify(listed)).toContain("hello.txt");

    const status = structured(await client.callTool({
      name: "session_authority_status",
      arguments: { authorityLeaseId: leaseId },
    }));
    expect(status.profile).toBe("project");

    const ended = structured(await client.callTool({
      name: "session_authority_end",
      arguments: { authorityLeaseId: leaseId },
    }));
    expect(ended).toEqual({ ended: true });
    await client.close();
  });
});
