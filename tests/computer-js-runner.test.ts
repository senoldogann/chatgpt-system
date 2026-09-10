import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const runnerPath = fileURLToPath(new URL("../dist/computer-js-runner.js", import.meta.url));
const cleanups: string[] = [];

interface RunnerExecution {
  messages: unknown[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

function isRpcMessage(value: unknown): value is {
  type: "rpc";
  id: string;
  method: string;
  params: unknown;
} {
  return typeof value === "object" && value !== null &&
    (value as { type?: unknown }).type === "rpc" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { method?: unknown }).method === "string";
}

async function tempCwd(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "chatgpt-system-js-runner-"));
  cleanups.push(directory);
  return directory;
}

async function runRunner(input: {
  cwd: string;
  source: string;
  onRpc?: (message: { type: "rpc"; id: string; method: string; params: unknown }) => unknown | undefined;
}): Promise<RunnerExecution> {
  return new Promise<RunnerExecution>((resolve, reject) => {
    const child = fork(runnerPath, [], {
      cwd: input.cwd,
      env: { ...process.env },
      execArgv: [],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const messages: unknown[] = [];
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("runner test timed out"));
    }, 3_000);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("message", (message) => {
      messages.push(message);
      if (!isRpcMessage(message) || input.onRpc === undefined) return;
      const response = input.onRpc(message);
      if (response !== undefined && child.connected) child.send(response);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        messages,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
      });
    });

    child.stdin?.end(input.source, "utf8");
  });
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("fixed full-host computer JavaScript runner", () => {
  it("executes stdin source with cwd-relative CommonJS require and dynamic import", async () => {
    const cwd = await tempCwd();
    await writeFile(path.join(cwd, "fixture.txt"), "fixture-value\n", "utf8");
    await writeFile(path.join(cwd, "fixture-module.mjs"), "export const value = 42;\n", "utf8");

    const execution = await runRunner({
      cwd,
      source: `
        const fs = require("node:fs");
        const imported = await import("./fixture-module.mjs");
        console.log("runner-output");
        return {
          text: fs.readFileSync("fixture.txt", "utf8").trim(),
          imported: imported.value,
        };
      `,
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.stdout).toContain("runner-output");
    const complete = execution.messages.find((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    ) as { type: "complete"; resultJson?: string } | undefined;
    expect(complete?.resultJson).toBeDefined();
    expect(JSON.parse(complete!.resultJson!)).toEqual({ text: "fixture-value", imported: 42 });
  });

  it("exposes only the Slice 3 computer proxy and round-trips strict RPC results", async () => {
    const cwd = await tempCwd();
    const rpcCalls: Array<{ method: string; params: unknown }> = [];
    const execution = await runRunner({
      cwd,
      source: `
        const missing = ["find", "exists"].filter((name) => name in computer);
        const clicked = await computer.click({ x: 12, y: 34 });
        return { missing, clicked };
      `,
      onRpc: (message) => {
        rpcCalls.push({ method: message.method, params: message.params });
        return {
          type: "rpc_result",
          id: message.id,
          ok: true,
          result: { state: "completed" },
        };
      },
    });

    expect(execution.exitCode).toBe(0);
    expect(rpcCalls).toEqual([{ method: "click", params: { x: 12, y: 34 } }]);
    const complete = execution.messages.find((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    ) as { resultJson?: string } | undefined;
    expect(JSON.parse(complete!.resultJson!)).toEqual({
      missing: [],
      clicked: { state: "completed" },
    });
  });

  it("contains process.exit inside the worker and reports only its exit code", async () => {
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: "process.exit(7);",
    });

    expect(execution.messages).toContainEqual({ type: "worker_exit", exitCode: 7 });
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });

  it("does not copy uncaught user exception details into the runner protocol", async () => {
    const secret = "STACK_SECRET_CANARY";
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: `throw new Error(${JSON.stringify(secret)});`,
    });

    expect(execution.messages).toContainEqual({ type: "worker_exit", exitCode: 1 });
    expect(JSON.stringify(execution.messages)).not.toContain(secret);
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });

  it("fails instead of completing when a non-undefined return value is not JSON serializable", async () => {
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: "return function notJsonSerializable() {};",
    });

    expect(execution.exitCode).not.toBe(0);
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });

  it("fails closed when user source completes while a computer RPC is still pending", async () => {
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: `
        void computer.pointerPosition();
        return "premature";
      `,
    });

    expect(execution.messages.some((message) => isRpcMessage(message) && message.method === "pointer_position")).toBe(true);
    expect(execution.exitCode).not.toBe(0);
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });

  it("fails closed on malformed worker protocol messages instead of forwarding arbitrary RPC", async () => {
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: `
        const { parentPort } = require("node:worker_threads");
        parentPort.postMessage({ type: "rpc", id: "malformed-worker-message-123", method: "not_allowed", params: {} });
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "should-not-complete";
      `,
    });

    expect(execution.exitCode).not.toBe(0);
    expect(execution.messages.some((message) => isRpcMessage(message) && message.method === "not_allowed")).toBe(false);
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });

  it("fails closed on malformed daemon RPC responses", async () => {
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: "return await computer.pointerPosition();",
      onRpc: (message) => ({
        type: "rpc_result",
        id: message.id,
        ok: true,
        result: { x: 1, y: 2 },
        unexpected: true,
      }),
    });

    expect(execution.exitCode).not.toBe(0);
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });

  it("rejects duplicate in-flight worker RPC ids", async () => {
    const execution = await runRunner({
      cwd: await tempCwd(),
      source: `
        const { parentPort } = require("node:worker_threads");
        const duplicate = { type: "rpc", id: "duplicate-rpc-id-123456", method: "pointer_position", params: {} };
        parentPort.postMessage(duplicate);
        parentPort.postMessage(duplicate);
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "should-not-complete";
      `,
    });

    expect(execution.exitCode).not.toBe(0);
    expect(execution.messages.filter((message) => isRpcMessage(message) && message.method === "pointer_position")).toHaveLength(1);
    expect(execution.messages.some((message) =>
      typeof message === "object" && message !== null && (message as { type?: unknown }).type === "complete"
    )).toBe(false);
  });
});
