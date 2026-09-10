import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComputerJsRunnerSupervisor,
  type ComputerJsSpawnOptions,
} from "../src/computer-js-runner-supervisor.js";

const runnerEntrypoint = fileURLToPath(new URL("../dist/computer-js-runner.js", import.meta.url));
const cleanups: string[] = [];
const supervisors: ComputerJsRunnerSupervisor[] = [];

async function tempCwd(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-supervisor-"));
  cleanups.push(cwd);
  return cwd;
}

function createSupervisor(overrides: Partial<ConstructorParameters<typeof ComputerJsRunnerSupervisor>[0]> = {}) {
  const supervisor = new ComputerJsRunnerSupervisor({
    runnerEntrypoint,
    maxSourceBytes: 262_144,
    maxOutputBytes: 1_048_576,
    processStopGraceMs: 50,
    ...overrides,
  });
  supervisors.push(supervisor);
  return supervisor;
}

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("ComputerJsRunnerSupervisor", () => {
  it("spawns one fixed runner with sanitized environment and supplies source only through stdin", async () => {
    const observed: Array<{
      command: string;
      args: string[];
      options: ComputerJsSpawnOptions;
    }> = [];
    const previousApiKey = process.env.CONTROL_PLANE_API_KEY;
    const previousCanary = process.env.CHATGPT_SYSTEM_TEST_CANARY;
    process.env.CONTROL_PLANE_API_KEY = "CONTROL_PLANE_SECRET_CANARY";
    process.env.CHATGPT_SYSTEM_TEST_CANARY = "ENV_SECRET_CANARY";

    try {
      const supervisor = createSupervisor({
        spawnProcess: (command, args, options): ChildProcess => {
          observed.push({ command, args: [...args], options });
          return spawn(command, [...args], options);
        },
      });
      const source = "return { value: 7 };";
      const result = await supervisor.run({
        source,
        cwd: await tempCwd(),
        timeoutMs: 3_000,
        onRpc: async () => ({ state: "completed" }),
      });

      expect(result).toEqual({ stdout: "", stderr: "", result: { value: 7 } });
      expect(observed).toHaveLength(1);
      expect(observed[0]?.command).toBe(process.execPath);
      expect(observed[0]?.args).toEqual([runnerEntrypoint]);
      expect(observed[0]?.options).toMatchObject({
        shell: false,
        cwd: expect.any(String),
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        detached: process.platform !== "win32",
      });
      expect(observed[0]?.options.env.CONTROL_PLANE_API_KEY).toBeUndefined();
      expect(observed[0]?.options.env.CHATGPT_SYSTEM_TEST_CANARY).toBeUndefined();
      expect(observed[0]?.options.env.HOME).toBe(process.env.HOME);
      expect(observed[0]?.options.env.PATH).toBe(process.env.PATH);
      expect(JSON.stringify(observed)).not.toContain(source);
    } finally {
      if (previousApiKey === undefined) delete process.env.CONTROL_PLANE_API_KEY;
      else process.env.CONTROL_PLANE_API_KEY = previousApiKey;
      if (previousCanary === undefined) delete process.env.CHATGPT_SYSTEM_TEST_CANARY;
      else process.env.CHATGPT_SYSTEM_TEST_CANARY = previousCanary;
    }
  });


  it("rejects oversized source before spawning", async () => {
    let spawnCount = 0;
    const supervisor = createSupervisor({
      maxSourceBytes: 8,
      spawnProcess: () => {
        spawnCount += 1;
        throw new Error("spawn should not happen");
      },
    });

    await expect(supervisor.run({
      source: "return 123456789;",
      cwd: await tempCwd(),
      timeoutMs: 3_000,
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
    expect(spawnCount).toBe(0);
  });

  it("enforces one combined stdout stderr and result byte budget and terminates the group", async () => {
    const signals: Array<{ target: number; signal: NodeJS.Signals }> = [];
    const supervisor = createSupervisor({
      maxOutputBytes: 24,
      signalProcess: (target, signal) => {
        signals.push({ target, signal });
        process.kill(target, signal);
      },
    });

    await expect(supervisor.run({
      source: `
        process.stdout.write("stdout-overflow-canary");
        process.stderr.write("stderr-overflow-canary");
        return { value: "result-overflow-canary" };
      `,
      cwd: await tempCwd(),
      timeoutMs: 3_000,
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_OUTPUT_LIMIT" });
    expect(signals.some(({ signal }) => signal === "SIGTERM" || signal === "SIGKILL")).toBe(true);
  });

  it("times out and escalates SIGTERM to SIGKILL for a runner group that does not stop", async () => {
    const signals: Array<{ target: number; signal: NodeJS.Signals }> = [];
    const supervisor = createSupervisor({
      processStopGraceMs: 20,
      signalProcess: (target, signal) => {
        signals.push({ target, signal });
        if (signal === "SIGKILL") process.kill(target, signal);
      },
    });

    await expect(supervisor.run({
      source: "await new Promise(() => {});",
      cwd: await tempCwd(),
      timeoutMs: 40,
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_JS_TIMEOUT" });
    expect(signals.map(({ signal }) => signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(signals[0]?.target).toBeLessThan(0);
  });

  it("cancels an active runner with a generic stable failure", async () => {
    const controller = new AbortController();
    const supervisor = createSupervisor();
    const running = supervisor.run({
      source: "await new Promise(() => {});",
      cwd: await tempCwd(),
      timeoutMs: 3_000,
      signal: controller.signal,
      onRpc: async () => ({}),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();

    await expect(running).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });
  });

  it("maps runner crash to a stable failure and starts the next call in a fresh child", async () => {
    const supervisor = createSupervisor();
    await expect(supervisor.run({
      source: "process.exit(9);",
      cwd: await tempCwd(),
      timeoutMs: 3_000,
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });

    await expect(supervisor.run({
      source: "return { recovered: true };",
      cwd: await tempCwd(),
      timeoutMs: 3_000,
      onRpc: async () => ({}),
    })).resolves.toMatchObject({ result: { recovered: true } });
  });

  it("makes user takeover fatal even when source tries to catch the computer RPC failure", async () => {
    const supervisor = createSupervisor();
    const takeover = new (await import("../src/computer-errors.js")).ComputerError("COMPUTER_USER_TAKEOVER");

    await expect(supervisor.run({
      source: `
        try {
          await computer.click({ x: 1, y: 2 });
        } catch {
          return { incorrectlyContinued: true };
        }
        return { incorrectlyContinued: true };
      `,
      cwd: await tempCwd(),
      timeoutMs: 3_000,
      onRpc: async () => { throw takeover; },
    })).rejects.toBe(takeover);
  });

  it("closes active work idempotently and rejects new runs", async () => {
    const supervisor = createSupervisor();
    const running = supervisor.run({
      source: "await new Promise(() => {});",
      cwd: await tempCwd(),
      timeoutMs: 5_000,
      onRpc: async () => ({}),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    await Promise.all([supervisor.close(), supervisor.close()]);
    await expect(running).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });
    await expect(supervisor.run({
      source: "return 1;",
      cwd: await tempCwd(),
      timeoutMs: 100,
      onRpc: async () => ({}),
    })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });
  });
});
