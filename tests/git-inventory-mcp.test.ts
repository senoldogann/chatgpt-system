import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/core/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

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
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-git-inventory-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "README.md"), "base\n", "utf8");
  await writeFile(path.join(root, ".gitignore"), "*.log\n", "utf8");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "inventory@example.invalid"]);
  git(root, ["config", "user.name", "Inventory Test"]);
  git(root, ["add", "README.md", ".gitignore"]);
  git(root, ["commit", "-q", "-m", "base"]);

  // Bir kategori+risk kombinasyonu üretir: modified/none, untracked/secret,
  // untracked/artifact, untracked/binary, ignored/none.
  await writeFile(path.join(root, "README.md"), "base\nchanged\n", "utf8");
  await writeFile(path.join(root, ".env"), "SECRET=1\n", "utf8");
  await mkdir(path.join(root, "build"), { recursive: true });
  await writeFile(path.join(root, "build", "output.o"), "binary-artifact\n", "utf8");
  await writeFile(path.join(root, "logo.png"), "not-a-real-png\n", "utf8");
  await writeFile(path.join(root, "debug.log"), "ignored\n", "utf8");

  const token = "git-inventory-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    projectExec: { enabled: false },
    continuity: {
      databasePath: path.join(base, "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },
    personalAdmin: { enabled: true },
    ownerRuntime: {
      enabled: false,
      shellPath: "/bin/zsh",
      maxScriptBytes: 262_144,
      maxTerminalSessions: 8,
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
    jevTargeting: { enabled: false, apiKey: null },
    browser: { enabled: false, headless: true, timeoutMs: 1_000, userDataDir: path.join(base, "browser") },
    control: { enabled: false, socketPath: path.join(base, "control.sock") },
    http: { host: "127.0.0.1", port: 0, allowNonLoopback: false, token },
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

  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "git-inventory-mcp-test", version: "1.0.0" });
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
    root,
    client,
    transport,
    authorityLeaseId: (started.structuredContent as { leaseId: string }).leaseId,
  };
}

describe("git_inventory MCP tool", () => {
  it("returns a schema-valid response with risk-classified entries across full pagination", async () => {
    const { root, client, transport, authorityLeaseId } = await fixture();
    try {
      const first = await client.callTool({
        name: "git_inventory",
        arguments: { authorityLeaseId, cwd: root, pageSize: 2 },
      });
      expect(first.isError, JSON.stringify(first)).not.toBe(true);
      expect(first.structuredContent).toBeDefined();

      const byPath = new Map<string, { category: string; risk: string }>();
      let page = first;
      let guard = 0;
      while (true) {
        const content = page.structuredContent as {
          entries: { path: string; category: string; risk: string }[];
          nextCursor?: number;
          snapshot: string;
          complete: boolean;
        };
        for (const entry of content.entries) byPath.set(entry.path, { category: entry.category, risk: entry.risk });
        if (content.complete || content.nextCursor === undefined) break;
        guard += 1;
        if (guard > 20) throw new Error("Pagination did not terminate.");
        page = await client.callTool({
          name: "git_inventory",
          arguments: { authorityLeaseId, cwd: root, pageSize: 2, cursor: content.nextCursor, snapshot: content.snapshot },
        });
        expect(page.isError, JSON.stringify(page)).not.toBe(true);
      }

      expect(byPath.get("README.md")).toEqual({ category: "modified", risk: "none" });
      expect(byPath.get(".env")).toEqual({ category: "untracked", risk: "secret" });
      expect(byPath.get("build/output.o")).toEqual({ category: "untracked", risk: "artifact" });
      expect(byPath.get("logo.png")).toEqual({ category: "untracked", risk: "binary" });
      expect(byPath.get("debug.log")).toEqual({ category: "ignored", risk: "none" });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
