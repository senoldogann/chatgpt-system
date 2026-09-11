import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
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

interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
  sha256: string;
}

interface SymbolResult {
  path: string;
  name: string;
  kind: string;
  line: number;
  column: number;
  sha256: string;
}

interface QueryResponse<T> {
  operation: "search" | "symbols";
  repositoryRoot: string;
  results: T[];
  truncated: boolean;
  scannedFiles: number;
  bytesScanned: number;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.processSupervisor.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-code-query-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  const sibling = path.join(base, "outside");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "ignored"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(sibling);

  await writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8");
  await writeFile(
    path.join(root, "src", "app.ts"),
    [
      'export const LIVE_NEEDLE = "query-needle";',
      "export function alphaOne(value: string) { return value; }",
      "export class Widget {}",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "deleted.ts"),
    'export const GONE_NEEDLE = "gone-needle";\n',
    "utf8",
  );

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "code-query@example.invalid"]);
  git(root, ["config", "user.name", "Code Query Test"]);
  git(root, ["add", ".gitignore", "src/app.ts", "src/deleted.ts"]);
  git(root, ["commit", "-q", "-m", "fixture"]);

  await writeFile(
    path.join(root, "src", "untracked.ts"),
    'export function untrackedFunction() { return "query-needle"; }\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "secret-manager.ts"),
    'export function secretManagerCode() { return "query-needle"; }\n',
    "utf8",
  );
  await writeFile(path.join(root, "README.md"), "Example only: function documentedOnly() {}\n", "utf8");
  await writeFile(path.join(root, "ignored", "ignored.ts"), 'export const IGNORED = "query-needle";\n', "utf8");
  await writeFile(path.join(root, "node_modules", "pkg", "index.js"), 'export const DEP = "query-needle";\n', "utf8");
  await writeFile(path.join(root, "dist", "bundle.js"), 'const BUILD = "query-needle";\n', "utf8");
  await writeFile(path.join(root, ".env"), "SECRET=query-needle\n", "utf8");
  await writeFile(path.join(root, "src", "blob.bin"), Buffer.from("\0query-needle\0", "utf8"));

  const token = "code-query-mcp-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    projectExec: { enabled: false },
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
    http: { host: "127.0.0.1", port: 0, token },
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

  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const client = new Client({ name: "code-query-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { base, root, sibling, client, transport };
}

async function startProjectLease(client: Client, root: string): Promise<string> {
  const started = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(started.isError).not.toBe(true);
  return (started.structuredContent as { leaseId: string }).leaseId;
}

describe("code_query MCP tool", () => {
  it("searches current repository content while honoring ignore and safety filters", async () => {
    const { root, sibling, client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "code_query");
      expect(tool).toBeDefined();
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });

      const leaseId = await startProjectLease(client, root);
      const first = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "search",
          query: "query-needle",
          cwd: root,
          maxResults: 20,
        },
      });
      expect(first.isError).not.toBe(true);
      const firstBody = first.structuredContent as unknown as QueryResponse<SearchResult>;
      expect(firstBody.operation).toBe("search");
      expect(firstBody.results.map((item) => item.path).sort()).toEqual([
        "src/app.ts",
        "src/secret-manager.ts",
        "src/untracked.ts",
      ]);
      expect(firstBody.results.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);
      expect(firstBody.results.every((item) => item.preview.includes("query-needle"))).toBe(true);
      expect(JSON.stringify(firstBody)).not.toContain("SECRET=");
      expect(JSON.stringify(firstBody)).not.toContain("node_modules");
      expect(JSON.stringify(firstBody)).not.toContain("dist/bundle.js");
      expect(JSON.stringify(firstBody)).not.toContain("ignored/ignored.ts");
      expect(JSON.stringify(firstBody)).not.toContain("blob.bin");

      const firstAppHash = firstBody.results.find((item) => item.path === "src/app.ts")?.sha256;
      expect(firstAppHash).toBeDefined();
      await writeFile(
        path.join(root, "src", "app.ts"),
        [
          'export const LIVE_NEEDLE = "query-needle";',
          "export function alphaOne(value: string) { return value.trim(); }",
          "export class Widget {}",
          "// dirty-current-content",
          "",
        ].join("\n"),
        "utf8",
      );

      const dirty = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "search", query: "query-needle", cwd: root },
      });
      expect(dirty.isError).not.toBe(true);
      const dirtyBody = dirty.structuredContent as unknown as QueryResponse<SearchResult>;
      const dirtyAppHash = dirtyBody.results.find((item) => item.path === "src/app.ts")?.sha256;
      expect(dirtyAppHash).toMatch(/^[a-f0-9]{64}$/);
      expect(dirtyAppHash).not.toBe(firstAppHash);

      const beforeDelete = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "search", query: "gone-needle", cwd: root },
      });
      expect((beforeDelete.structuredContent as unknown as QueryResponse<SearchResult>).results.map((item) => item.path)).toEqual(["src/deleted.ts"]);
      await unlink(path.join(root, "src", "deleted.ts"));
      const afterDelete = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "search", query: "gone-needle", cwd: root },
      });
      expect((afterDelete.structuredContent as unknown as QueryResponse<SearchResult>).results).toEqual([]);

      const bounded = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "search", query: "export", cwd: root, maxResults: 1 },
      });
      const boundedBody = bounded.structuredContent as unknown as QueryResponse<SearchResult>;
      expect(boundedBody.results).toHaveLength(1);
      expect(boundedBody.truncated).toBe(true);

      const outside = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "search", query: "anything", cwd: sibling },
      });
      expect(outside.isError).toBe(true);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("returns lightweight current-file symbols with content hashes", async () => {
    const { root, client, transport } = await fixture();
    try {
      const leaseId = await startProjectLease(client, root);
      const result = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "symbols", cwd: root, maxResults: 20 },
      });

      expect(result.isError).not.toBe(true);
      const body = result.structuredContent as unknown as QueryResponse<SymbolResult>;
      expect(body.operation).toBe("symbols");
      expect(body.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "src/app.ts", name: "LIVE_NEEDLE", kind: "variable", line: 1 }),
        expect.objectContaining({ path: "src/app.ts", name: "alphaOne", kind: "function", line: 2 }),
        expect.objectContaining({ path: "src/app.ts", name: "Widget", kind: "class", line: 3 }),
        expect.objectContaining({ path: "src/untracked.ts", name: "untrackedFunction", kind: "function", line: 1 }),
      ]));
      expect(body.results.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);
      expect(body.results.some((item) => item.path.includes("ignored"))).toBe(false);
      expect(body.results.some((item) => item.path.includes("node_modules"))).toBe(false);
      expect(body.results.some((item) => item.path.includes("dist/"))).toBe(false);
      expect(body.results.some((item) => item.path === ".env")).toBe(false);
      expect(body.results.some((item) => item.name === "documentedOnly")).toBe(false);
      expect(body.results.some((item) => item.name === "secretManagerCode")).toBe(true);

      const filtered = await client.callTool({
        name: "code_query",
        arguments: { authorityLeaseId: leaseId, operation: "symbols", query: "widget", cwd: root, maxResults: 20 },
      });
      const filteredBody = filtered.structuredContent as unknown as QueryResponse<SymbolResult>;
      expect(filteredBody.results.map((item) => item.name)).toEqual(["Widget"]);

      const audit = await readFile(path.join(path.dirname(root), "audit.jsonl"), "utf8");
      expect(audit).not.toContain("query-needle");
      expect(audit).not.toContain("alphaOne");
      expect(audit).not.toContain("Widget");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
