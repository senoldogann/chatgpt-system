import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function scopeFingerprint(root: string): string {
  return createHash("sha256").update("roots\0").update(root).digest("hex");
}

function patch(from: string, to: string): string {
  return `@@ -1 +1 @@\n-${from}\n+${to}\n`;
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
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
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-patch-set-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  const outside = path.join(base, "outside.txt");
  const stateRoot = path.join(base, "home", ".chatgpt-system", "state");
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "a.txt"), "alpha\n", "utf8");
  await writeFile(path.join(root, "b.txt"), "bravo\n", "utf8");
  await writeFile(outside, "outside\n", "utf8");

  const token = "patch-set-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    projectExec: { enabled: false },
    personalAdmin: { enabled: false },
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

  const runtime = createRuntimeServices(config, { taskStateRoot: stateRoot });
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "patch-set-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  const started = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(started.isError).not.toBe(true);
  const lease = started.structuredContent as { leaseId: string; roots: string[] };
  const canonicalRoot = lease.roots[0]!;
  return {
    base,
    root,
    canonicalRoot,
    outside,
    stateRoot,
    runtime,
    server,
    client,
    transport,
    authorityLeaseId: lease.leaseId,
  };
}

describe("fs_apply_patch_set MCP tool", () => {
  it("validates then atomically replaces a bounded set of files", async () => {
    const { root, client, transport, authorityLeaseId } = await fixture();
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "fs_apply_patch_set");
      expect(tool).toBeDefined();
      expect(tool?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      });

      const result = await client.callTool({
        name: "fs_apply_patch_set",
        arguments: {
          authorityLeaseId,
          patches: [
            { path: "a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "alpha patched") },
            { path: "b.txt", expectedSha256: sha256("bravo\n"), patch: patch("bravo", "bravo patched") },
          ],
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        recoveredTransactions: 0,
        applied: [
          { path: "a.txt", sha256: sha256("alpha patched\n") },
          { path: "b.txt", sha256: sha256("bravo patched\n") },
        ],
      });
      expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha patched\n");
      expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("bravo patched\n");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("leaves every destination unchanged on stale hash, invalid patch, duplicate path, or symlink escape", async () => {
    const { root, outside, client, transport, authorityLeaseId } = await fixture();
    try {
      await writeFile(path.join(root, "b.txt"), "bravo changed concurrently\n", "utf8");
      const stale = await client.callTool({
        name: "fs_apply_patch_set",
        arguments: {
          authorityLeaseId,
          patches: [
            { path: "a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "should not apply") },
            { path: "b.txt", expectedSha256: sha256("bravo\n"), patch: patch("bravo", "also should not apply") },
          ],
        },
      });
      expect(stale.isError).toBe(true);
      expect(textResult(stale)).toContain("CONFLICT");
      expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha\n");
      expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("bravo changed concurrently\n");

      await writeFile(path.join(root, "b.txt"), "bravo\n", "utf8");
      const invalid = await client.callTool({
        name: "fs_apply_patch_set",
        arguments: {
          authorityLeaseId,
          patches: [
            { path: "a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "should not apply") },
            { path: "b.txt", expectedSha256: sha256("bravo\n"), patch: "@@ invalid patch @@" },
          ],
        },
      });
      expect(invalid.isError).toBe(true);
      expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha\n");
      expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("bravo\n");

      const duplicate = await client.callTool({
        name: "fs_apply_patch_set",
        arguments: {
          authorityLeaseId,
          patches: [
            { path: "a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "one") },
            { path: "./a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "two") },
          ],
        },
      });
      expect(duplicate.isError).toBe(true);
      expect(textResult(duplicate)).toContain("POLICY_DENIED");
      expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha\n");

      await symlink(outside, path.join(root, "escape.txt"));
      const escaped = await client.callTool({
        name: "fs_apply_patch_set",
        arguments: {
          authorityLeaseId,
          patches: [
            { path: "a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "should not apply") },
            { path: "escape.txt", expectedSha256: sha256("outside\n"), patch: patch("outside", "escaped") },
          ],
        },
      });
      expect(escaped.isError).toBe(true);
      expect(textResult(escaped)).toContain("POLICY_DENIED");
      expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("alpha\n");
      expect(await readFile(outside, "utf8")).toBe("outside\n");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("rolls back an interrupted committing journal before handling the next request", async () => {
    const { canonicalRoot, stateRoot, client, transport, authorityLeaseId } = await fixture();
    try {
      const transactionId = randomUUID();
      const scope = scopeFingerprint(canonicalRoot);
      const journalDirectory = path.join(stateRoot, "patch-transactions", scope);
      await mkdir(journalDirectory, { recursive: true });
      const a = path.join(canonicalRoot, "a.txt");
      const b = path.join(canonicalRoot, "b.txt");
      const aBackup = path.join(canonicalRoot, `.a.txt.${transactionId}.backup`);
      const bBackup = path.join(canonicalRoot, `.b.txt.${transactionId}.backup`);
      const aTemp = path.join(canonicalRoot, `.a.txt.${transactionId}.next`);
      const bTemp = path.join(canonicalRoot, `.b.txt.${transactionId}.next`);
      await writeFile(aBackup, "alpha\n", "utf8");
      await writeFile(bBackup, "bravo\n", "utf8");
      await writeFile(bTemp, "bravo patched\n", "utf8");
      await writeFile(a, "alpha patched\n", "utf8");

      await writeFile(path.join(journalDirectory, `${transactionId}.json`), `${JSON.stringify({
        version: 1,
        transactionId,
        scopeFingerprint: scope,
        state: "committing",
        createdAt: new Date().toISOString(),
        entries: [
          {
            target: a,
            displayPath: "a.txt",
            temp: aTemp,
            backup: aBackup,
            originalSha256: sha256("alpha\n"),
            newSha256: sha256("alpha patched\n"),
            mode: 0o644,
          },
          {
            target: b,
            displayPath: "b.txt",
            temp: bTemp,
            backup: bBackup,
            originalSha256: sha256("bravo\n"),
            newSha256: sha256("bravo patched\n"),
            mode: 0o644,
          },
        ],
      }, null, 2)}\n`, "utf8");

      const request = await client.callTool({
        name: "fs_apply_patch_set",
        arguments: {
          authorityLeaseId,
          patches: [
            { path: "a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "one") },
            { path: "./a.txt", expectedSha256: sha256("alpha\n"), patch: patch("alpha", "two") },
          ],
        },
      });
      expect(request.isError).toBe(true);
      expect(await readFile(a, "utf8")).toBe("alpha\n");
      expect(await readFile(b, "utf8")).toBe("bravo\n");
      await expect(readFile(aBackup)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(bBackup)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(bTemp)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(path.join(journalDirectory, `${transactionId}.json`))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
