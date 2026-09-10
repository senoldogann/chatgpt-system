import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { ComputerJsRuntime } from "../src/computer-js-runtime.js";
import {
  ComputerJsRunnerSupervisor,
  type ComputerJsSpawnOptions,
} from "../src/computer-js-runner-supervisor.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "../src/computer-runtime.js";
import type { ComputerUseConfig } from "../src/config.js";
import type { ComputerNativeMethod } from "../src/computer-types.js";
import { ScopedComputerJsService } from "../src/scoped-computer-js-service.js";

const runnerEntrypoint = fileURLToPath(new URL("../dist/computer-js-runner.js", import.meta.url));
const cleanups: string[] = [];
const closeables: Array<{ close(): Promise<void> }> = [];

const computerConfig: ComputerUseConfig = {
  enabled: true,
  fullHostJsEnabled: true,
  hostBundlePath: "/tmp/fixture.app",
  requestTimeoutMs: 10_000,
  maxObservationElements: 500,
  maxObservationChars: 262_144,
  maxScreenshotBytes: 8_388_608,
  maxActionProgramActions: 100,
  maxActionProgramRuntimeMs: 30_000,
  maxJsSourceBytes: 262_144,
  maxJsRuntimeMs: 30_000,
  maxJsOutputBytes: 1_048_576,
};

class FakeNative implements ComputerNativeRequesting {
  readonly calls: Array<{ method: ComputerNativeMethod; params: Record<string, unknown> }> = [];

  healthState() { return "running" as const; }
  async request(method: ComputerNativeMethod, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    return { state: "completed" };
  }
  async close(): Promise<void> {}
}

async function tempDir(prefix = "chatgpt-system-js-integration-"): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  cleanups.push(directory);
  return directory;
}

function createSupervisor(overrides: Partial<ConstructorParameters<typeof ComputerJsRunnerSupervisor>[0]> = {}) {
  const supervisor = new ComputerJsRunnerSupervisor({
    runnerEntrypoint,
    maxSourceBytes: computerConfig.maxJsSourceBytes,
    maxOutputBytes: computerConfig.maxJsOutputBytes,
    processStopGraceMs: 100,
    ...overrides,
  });
  closeables.push(supervisor);
  return supervisor;
}

async function createRuntime(root: string) {
  const native = new FakeNative();
  const computer = new ComputerRuntime(native, computerConfig);
  const supervisor = createSupervisor();
  const runtime = new ComputerJsRuntime(computer, { roots: [root], computerUse: computerConfig }, supervisor);
  closeables.push(runtime, computer);
  return { native, computer, supervisor, runtime };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  for (const closeable of closeables.splice(0).reverse()) {
    try { await closeable.close(); } catch { /* cleanup-only */ }
  }
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("full-host computer JavaScript real-runner integration", () => {
  it("uses normal Node require and cwd-relative dynamic import", async () => {
    const cwd = await tempDir();
    await writeFile(path.join(cwd, "fixture.txt"), "fixture-value", "utf8");
    await writeFile(path.join(cwd, "fixture-module.mjs"), "export default 'module-value';\n", "utf8");
    const supervisor = createSupervisor();

    const result = await supervisor.run({
      cwd,
      timeoutMs: 4_000,
      source: `
        const fs = require("node:fs");
        const moduleValue = await import("./fixture-module.mjs");
        return {
          file: fs.readFileSync("fixture.txt", "utf8"),
          imported: moduleValue.default,
        };
      `,
      onRpc: async () => ({}),
    });

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      result: { file: "fixture-value", imported: "module-value" },
    });
  });

  it("runs local control flow and mediates computer RPC through the parent session", async () => {
    const root = await tempDir();
    const { native, runtime } = await createRuntime(root);

    const result = await runtime.run({
      timeoutMs: 4_000,
      source: `
        let total = 0;
        for (let i = 0; i < 4; i += 1) total += i;
        if (total === 6) await computer.click({ x: 17, y: 23, button: "left" });
        return { total };
      `,
    });

    expect(result.result).toEqual({ total: 6 });
    expect(native.calls).toContainEqual({ method: "click", params: { x: 17, y: 23, button: "left" } });
    expect(native.calls.some((call) => call.method === "release_inputs")).toBe(true);
  });

  it.skipIf(process.platform === "win32")("terminates an ordinary descendant when a successful program finalizes", async () => {
    const cwd = await tempDir();
    const marker = path.join(cwd, "descendant-survived.txt");
    const supervisor = createSupervisor();
    const childCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 500); setInterval(() => {}, 1000);`;

    await supervisor.run({
      cwd,
      timeoutMs: 4_000,
      source: `
        const { spawn } = require("node:child_process");
        spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "ignore" });
        return { spawned: true };
      `,
      onRpc: async () => ({}),
    });

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await exists(marker)).toBe(false);
  });

  it("contains process.exit to one call and starts the next call in a fresh child", async () => {
    const cwd = await tempDir();
    const supervisor = createSupervisor();

    await expect(supervisor.run({
      cwd,
      timeoutMs: 4_000,
      source: "process.exit(7);",
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });

    await expect(supervisor.run({
      cwd,
      timeoutMs: 4_000,
      source: "return { recovered: true };",
      onRpc: async () => ({}),
    })).resolves.toMatchObject({ result: { recovered: true } });
  });

  it.skipIf(process.platform === "win32")("kills an ordinary descendant when the program times out", async () => {
    const cwd = await tempDir();
    const marker = path.join(cwd, "timeout-descendant-survived.txt");
    const supervisor = createSupervisor();
    const childCode = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 500); setInterval(() => {}, 1000);`;

    await expect(supervisor.run({
      cwd,
      timeoutMs: 120,
      source: `
        const { spawn } = require("node:child_process");
        spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "ignore" });
        await new Promise(() => {});
      `,
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_JS_TIMEOUT" });

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await exists(marker)).toBe(false);
  });

  it("sanitizes daemon secrets while preserving basic user environment and never places source in argv or env", async () => {
    const cwd = await tempDir();
    const observed: Array<{ command: string; args: string[]; options: ComputerJsSpawnOptions }> = [];
    const oldApiKey = process.env.CONTROL_PLANE_API_KEY;
    const oldCanary = process.env.CHATGPT_SYSTEM_TEST_CANARY;
    process.env.CONTROL_PLANE_API_KEY = "CONTROL_PLANE_SECRET_CANARY";
    process.env.CHATGPT_SYSTEM_TEST_CANARY = "ENV_SECRET_CANARY";
    const source = `return {
      controlPlane: process.env.CONTROL_PLANE_API_KEY ?? null,
      canary: process.env.CHATGPT_SYSTEM_TEST_CANARY ?? null,
      homePresent: typeof process.env.HOME === "string",
      pathPresent: typeof process.env.PATH === "string",
    };`;

    try {
      const supervisor = createSupervisor({
        spawnProcess: (command, args, options): ChildProcess => {
          observed.push({ command, args: [...args], options });
          return spawn(command, [...args], options);
        },
      });
      const result = await supervisor.run({ cwd, timeoutMs: 4_000, source, onRpc: async () => ({}) });

      expect(result.result).toEqual({ controlPlane: null, canary: null, homePresent: true, pathPresent: true });
      expect(JSON.stringify(observed)).not.toContain(source);
      expect(observed[0]?.options.env.CONTROL_PLANE_API_KEY).toBeUndefined();
      expect(observed[0]?.options.env.CHATGPT_SYSTEM_TEST_CANARY).toBeUndefined();
    } finally {
      if (oldApiKey === undefined) delete process.env.CONTROL_PLANE_API_KEY;
      else process.env.CONTROL_PLANE_API_KEY = oldApiKey;
      if (oldCanary === undefined) delete process.env.CHATGPT_SYSTEM_TEST_CANARY;
      else process.env.CHATGPT_SYSTEM_TEST_CANARY = oldCanary;
    }
  });

  it("applies omitted relative and absolute cwd semantics with the real runner", async () => {
    const root = await tempDir();
    const relative = path.join(root, "nested");
    const absolute = await tempDir("chatgpt-system-js-absolute-");
    await mkdir(relative);
    const { runtime } = await createRuntime(root);

    const omitted = await runtime.run({ source: "return process.cwd();", timeoutMs: 4_000 });
    const nested = await runtime.run({ source: "return process.cwd();", cwd: "nested", timeoutMs: 4_000 });
    const outside = await runtime.run({ source: "return process.cwd();", cwd: absolute, timeoutMs: 4_000 });

    expect(omitted.result).toBe(await (await import("node:fs/promises")).realpath(root));
    expect(nested.result).toBe(await (await import("node:fs/promises")).realpath(relative));
    expect(outside.result).toBe(await (await import("node:fs/promises")).realpath(absolute));
  });

  it("drains bounded stdout and stderr completely before successful descendant cleanup", async () => {
    const cwd = await tempDir();
    const supervisor = createSupervisor();
    const stdoutBytes = 500_000;
    const stderrBytes = 100_000;

    const result = await supervisor.run({
      cwd,
      timeoutMs: 4_000,
      source: `
        process.stdout.write("x".repeat(${stdoutBytes}));
        process.stderr.write("y".repeat(${stderrBytes}));
        return { complete: true };
      `,
      onRpc: async () => ({}),
    });

    expect(Buffer.byteLength(result.stdout, "utf8")).toBe(stdoutBytes);
    expect(Buffer.byteLength(result.stderr, "utf8")).toBe(stderrBytes);
    expect(result.result).toEqual({ complete: true });
  });

  it("returns stdout stderr and result to the caller while keeping them and source out of audit", async () => {
    const root = await tempDir();
    const auditFile = path.join(root, "audit.jsonl");
    const { runtime } = await createRuntime(root);
    const service = new ScopedComputerJsService(runtime, new AuditLogger(auditFile), true, true);
    const source = `
      console.log("STDOUT_SECRET_CANARY");
      console.error("STDERR_SECRET_CANARY");
      return { secret: "RESULT_SECRET_CANARY" };
    `;

    const result = await service.run({ source, timeoutMs: 4_000 });
    expect(result.stdout).toContain("STDOUT_SECRET_CANARY");
    expect(result.stderr).toContain("STDERR_SECRET_CANARY");
    expect(result.result).toEqual({ secret: "RESULT_SECRET_CANARY" });

    const audit = await readFile(auditFile, "utf8");
    expect(audit).toContain('"action":"computer.run_js"');
    for (const forbidden of [source, "STDOUT_SECRET_CANARY", "STDERR_SECRET_CANARY", "RESULT_SECRET_CANARY"]) {
      expect(audit).not.toContain(forbidden);
    }
  });
});
