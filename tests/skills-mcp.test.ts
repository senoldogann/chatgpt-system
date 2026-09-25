import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/core/config.js";
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
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-skills-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root, { recursive: true });
  const token = "skills-test-token-0123456789abcdef";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: [] },
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
      commandTimeoutMs: 2_000,
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: 100,
    },
  };
  const server = startHttp(createRuntimeServices(config));
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "skills-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { base, client };
}

function structured(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}

describe("skills MCP tools", () => {
  it("lists empty catalog, imports, reads and removes a skill without any lease", async () => {
    const { base, client } = await fixture();
    const empty = structured(await client.callTool({ name: "skills_list", arguments: {} }));
    expect(empty).toEqual({ skills: [] });

    const sourceDir = path.join(base, "incoming");
    await mkdir(sourceDir, { recursive: true });
    const source = path.join(sourceDir, "deploy-check.md");
    await writeFile(source, "---\nname: Deploy Check\ndescription: Pre-deploy verification checklist.\n---\n\n# Deploy Check\n\nVerify migrations before deploy.\n", "utf8");

    const imported = structured(await client.callTool({ name: "skills_import", arguments: { path: source } }));
    const summary = imported.summary as Record<string, unknown>;
    expect(summary.id).toBe("deploy-check");
    expect(summary.name).toBe("Deploy Check");
    expect(summary.description).toContain("Pre-deploy");

    const listed = structured(await client.callTool({ name: "skills_list", arguments: {} }));
    expect((listed.skills as unknown[]).length).toBe(1);

    const read = structured(await client.callTool({ name: "skills_read", arguments: { id: "deploy-check" } }));
    expect((read.text as string)).toContain("Verify migrations");

    const removed = structured(await client.callTool({ name: "skills_remove", arguments: { id: "deploy-check" } }));
    expect(removed).toEqual({ removed: true });
    const after = structured(await client.callTool({ name: "skills_list", arguments: {} }));
    expect(after).toEqual({ skills: [] });
    await client.close();
  });

  it("falls back to heading metadata and rejects duplicates, non-markdown and missing skills", async () => {
    const { base, client } = await fixture();
    const source = path.join(base, "notes.md");
    await writeFile(source, "# Plain Notes\n\nFirst paragraph becomes the description.\n", "utf8");
    const imported = structured(await client.callTool({ name: "skills_import", arguments: { path: source } }));
    expect((imported.summary as Record<string, unknown>).name).toBe("Plain Notes");

    const duplicate = await client.callTool({ name: "skills_import", arguments: { path: source } });
    expect(duplicate.isError).toBe(true);

    const other = path.join(base, "other.txt");
    await writeFile(other, "not markdown skill", "utf8");
    const nonMarkdown = await client.callTool({ name: "skills_import", arguments: { path: other } });
    expect(nonMarkdown.isError).toBe(true);

    const missing = await client.callTool({ name: "skills_read", arguments: { id: "nope" } });
    expect(missing.isError).toBe(true);
    await client.close();
  });

  it("rejects control characters and oversized skill files", async () => {
    const { base, client } = await fixture();
    const bad = path.join(base, "bad.md");
    await writeFile(bad, "# Bad\n\nContains \u0007 bell.\n", "utf8");
    expect((await client.callTool({ name: "skills_import", arguments: { path: bad } })).isError).toBe(true);

    const big = path.join(base, "big.md");
    await writeFile(big, `# Big\n\n${"x".repeat(130_000)}\n`, "utf8");
    expect((await client.callTool({ name: "skills_import", arguments: { path: big } })).isError).toBe(true);
    await client.close();
  });

  it("does not follow symlinked skill entries", async () => {
    const { base, client } = await fixture();
    const outside = path.join(base, "outside.md");
    await writeFile(outside, "# Outside\n\nNot in library.\n", "utf8");
    const skillsDir = path.join(base, "skills");
    await mkdir(skillsDir, { recursive: true });
    await symlink(outside, path.join(skillsDir, "linked"));
    const listed = structured(await client.callTool({ name: "skills_list", arguments: {} }));
    expect(listed).toEqual({ skills: [] });
    await client.close();
  });
});
