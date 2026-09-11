import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

interface LocationResult {
  path: string;
  line: number;
  column: number;
  sha256: string;
}

interface ReferenceResult extends LocationResult {
  isDefinition: boolean;
}

interface DiagnosticResult extends LocationResult {
  severity: "error" | "warning" | "suggestion" | "message";
  code: number;
  message: string;
}

interface SemanticResponse<T> {
  operation: "definition" | "references" | "diagnostics";
  repositoryRoot: string;
  results: T[];
  truncated: boolean;
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
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
}

function positionOf(text: string, needle: string, fromEnd = false): { line: number; column: number } {
  const offset = fromEnd ? text.lastIndexOf(needle) : text.indexOf(needle);
  if (offset < 0) throw new Error(`Missing fixture needle: ${needle}`);
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: lines.at(-1)!.length + 1 };
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-code-query-lsp-"));
  cleanups.push(base);
  const root = path.join(base, "repo");
  const outside = path.join(base, "outside.ts");
  await mkdir(path.join(root, "src"), { recursive: true });

  const defs = 'export function greet(name: string): string { return `hello ${name}`; }\n';
  const use = [
    'import { greet } from "./defs.js";',
    "export const message = greet(123);",
    "",
  ].join("\n");
  const escape = [
    'import { outsideValue } from "../../outside.js";',
    "export const escaped = outsideValue;",
    "",
  ].join("\n");

  await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
    },
    include: ["src/**/*.ts"],
  }, null, 2), "utf8");
  await writeFile(path.join(root, "src", "defs.ts"), defs, "utf8");
  await writeFile(path.join(root, "src", "use.ts"), use, "utf8");
  await writeFile(path.join(root, "src", "escape.ts"), escape, "utf8");
  await writeFile(path.join(root, "src", "unsupported.py"), "def greet():\n    return 'python'\n", "utf8");
  await writeFile(outside, "export const outsideValue = 42;\n", "utf8");

  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "code-query-lsp@example.invalid"]);
  git(root, ["config", "user.name", "Code Query LSP Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture"]);

  const token = "code-query-lsp-token-0123456789";
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
  const client = new Client({ name: "code-query-lsp-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { base, root, outside, defs, use, escape, client, transport };
}

async function startProjectLease(client: Client, root: string): Promise<string> {
  const started = await client.callTool({
    name: "session_authority_start",
    arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 120 },
  });
  expect(started.isError).not.toBe(true);
  return (started.structuredContent as { leaseId: string }).leaseId;
}

function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("code_query TypeScript semantic operations", () => {
  it("returns current definitions, references, and diagnostics without escaping the repository", async () => {
    const { root, defs, use, escape, client, transport } = await fixture();
    try {
      const leaseId = await startProjectLease(client, root);
      const callPosition = positionOf(use, "greet", true);
      const definition = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "definition",
          cwd: root,
          path: "src/use.ts",
          ...callPosition,
          maxResults: 10,
        },
      });
      expect(definition.isError).not.toBe(true);
      const definitionBody = definition.structuredContent as unknown as SemanticResponse<LocationResult>;
      expect(definitionBody.operation).toBe("definition");
      expect(definitionBody.results).toEqual([
        expect.objectContaining({
          path: "src/defs.ts",
          line: 1,
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);

      const declarationPosition = positionOf(defs, "greet");
      const references = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "references",
          cwd: root,
          path: "src/defs.ts",
          ...declarationPosition,
          maxResults: 20,
        },
      });
      expect(references.isError).not.toBe(true);
      const referencesBody = references.structuredContent as unknown as SemanticResponse<ReferenceResult>;
      expect(referencesBody.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "src/defs.ts", isDefinition: true }),
        expect.objectContaining({ path: "src/use.ts" }),
      ]));
      expect(referencesBody.results.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);

      const diagnostics = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "diagnostics",
          cwd: root,
          path: "src/use.ts",
          maxResults: 20,
        },
      });
      expect(diagnostics.isError).not.toBe(true);
      const diagnosticsBody = diagnostics.structuredContent as unknown as SemanticResponse<DiagnosticResult>;
      expect(diagnosticsBody.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "src/use.ts", severity: "error", code: 2345 }),
      ]));

      await writeFile(
        path.join(root, "src", "defs.ts"),
        'export function greet(name: number): string { return `hello ${name}`; }\n',
        "utf8",
      );
      const refreshed = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "diagnostics",
          cwd: root,
          path: "src/use.ts",
          maxResults: 20,
        },
      });
      expect(refreshed.isError).not.toBe(true);
      expect((refreshed.structuredContent as unknown as SemanticResponse<DiagnosticResult>).results.some((item) => item.code === 2345)).toBe(false);

      const escapePosition = positionOf(escape, "outsideValue", true);
      const escaped = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "definition",
          cwd: root,
          path: "src/escape.ts",
          ...escapePosition,
        },
      });
      expect(escaped.isError).not.toBe(true);
      expect((escaped.structuredContent as unknown as SemanticResponse<LocationResult>).results).toEqual([]);
      expect(JSON.stringify(escaped.structuredContent)).not.toContain("outside.ts");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("fails explicitly with LSP_UNAVAILABLE for unsupported language semantics and keeps payloads out of audit", async () => {
    const { base, root, client, transport } = await fixture();
    try {
      const leaseId = await startProjectLease(client, root);
      const unsupported = await client.callTool({
        name: "code_query",
        arguments: {
          authorityLeaseId: leaseId,
          operation: "definition",
          cwd: root,
          path: "src/unsupported.py",
          line: 1,
          column: 5,
        },
      });
      expect(unsupported.isError).toBe(true);
      expect(resultText(unsupported)).toContain("LSP_UNAVAILABLE");
      expect(resultText(unsupported)).toContain("search");
      expect(resultText(unsupported)).toContain("symbols");

      const audit = await readFile(path.join(base, "audit.jsonl"), "utf8");
      expect(audit).not.toContain("greet");
      expect(audit).not.toContain("not assignable");
      expect(audit).not.toContain("unsupported.py");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
