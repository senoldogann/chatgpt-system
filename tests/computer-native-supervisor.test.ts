import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ComputerNativeSupervisor,
  type ComputerSpawn,
} from "../src/computer-native-supervisor.js";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid: number;
  killed = false;
  killSignals: Array<NodeJS.Signals | number | undefined> = [];

  constructor(pid: number, closeOnKill = true) {
    super();
    this.pid = pid;
    if (closeOnKill) {
      this.stdin.on("finish", () => queueMicrotask(() => this.emit("close", 0, null)));
    }
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    this.killSignals.push(signal);
    queueMicrotask(() => this.emit("close", null, typeof signal === "string" ? signal : null));
    return true;
  }
}

function respondToRequests(child: FakeChild, resultFactory: (request: Record<string, unknown>) => unknown): void {
  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const request = JSON.parse(line) as Record<string, unknown>;
      child.stdout.write(JSON.stringify({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        result: resultFactory(request),
      }) + "\n");
    }
  });
}

function spawnFixture(onChild?: (child: FakeChild, index: number) => void) {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const children: FakeChild[] = [];
  const spawn: ComputerSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild(10_000 + children.length);
    children.push(child);
    onChild?.(child, children.length - 1);
    queueMicrotask(() => child.emit("spawn"));
    return child as unknown as ChildProcess;
  };
  return { spawn, calls, children };
}

const BUNDLE = "/Users/test/.chatgpt-system/ChatGPTSystemComputerRuntime.app";

function supervisor(spawnImpl: ComputerSpawn, overrides: Partial<ConstructorParameters<typeof ComputerNativeSupervisor>[0]> = {}) {
  return new ComputerNativeSupervisor({
    enabled: true,
    hostBundlePath: BUNDLE,
    requestTimeoutMs: 100,
    stderrLimitBytes: 32,
    closeGraceMs: 20,
    spawnImpl,
    ...overrides,
  });
}

describe("ComputerNativeSupervisor", () => {
  it("does not spawn while computer use is disabled", async () => {
    const fixture = spawnFixture();
    const runtime = new ComputerNativeSupervisor({
      enabled: false,
      hostBundlePath: BUNDLE,
      requestTimeoutMs: 100,
      spawnImpl: fixture.spawn,
    });

    expect(runtime.healthState()).toBe("disabled");
    await expect(runtime.request("health", {})).rejects.toMatchObject({ code: "COMPUTER_DISABLED" });
    expect(fixture.calls).toHaveLength(0);
  });

  it("spawns only the fixed bundle executable with shell false and private stdio pipes", async () => {
    const fixture = spawnFixture((child) => respondToRequests(child, () => ({ state: "running" })));
    const runtime = supervisor(fixture.spawn);

    await expect(runtime.request("health", {})).resolves.toEqual({ state: "running" });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toMatchObject({
      command: path.join(BUNDLE, "Contents", "MacOS", "chatgpt-system-computer-runtime"),
      args: [],
      options: { shell: false, stdio: ["pipe", "pipe", "pipe"] },
    });
    expect(runtime.healthState()).toBe("running");
  });

  it("coalesces concurrent first callers onto one lazy start", async () => {
    const fixture = spawnFixture((child) => respondToRequests(child, (request) => ({ method: request.method })));
    const runtime = supervisor(fixture.spawn);

    const [health, observe] = await Promise.all([
      runtime.request("health", {}),
      runtime.request("observe", {}),
    ]);

    expect(health).toEqual({ method: "health" });
    expect(observe).toEqual({ method: "observe" });
    expect(fixture.calls).toHaveLength(1);
  });

  it("fails pending work on child crash and starts a fresh helper on a later call", async () => {
    const fixture = spawnFixture((child, index) => {
      if (index === 1) respondToRequests(child, () => ({ generation: 2 }));
    });
    const runtime = supervisor(fixture.spawn);

    const pending = runtime.request("observe", {});
    await new Promise((resolve) => setImmediate(resolve));
    fixture.children[0]!.emit("close", 1, null);

    await expect(pending).rejects.toMatchObject({ code: "COMPUTER_UNAVAILABLE" });
    expect(runtime.healthState()).toBe("unavailable");
    await expect(runtime.request("health", {})).resolves.toEqual({ generation: 2 });
    expect(fixture.calls).toHaveLength(2);
    expect(runtime.healthState()).toBe("running");
  });

  it("discards a timed-out child and recovers with a fresh child", async () => {
    const fixture = spawnFixture((child, index) => {
      if (index === 1) respondToRequests(child, () => ({ generation: 2 }));
    });
    const runtime = supervisor(fixture.spawn, { requestTimeoutMs: 15 });

    await expect(runtime.request("health", {})).rejects.toMatchObject({ code: "COMPUTER_TIMEOUT" });
    expect(fixture.children[0]?.killed).toBe(true);
    await expect(runtime.request("health", {})).resolves.toEqual({ generation: 2 });
    expect(fixture.calls).toHaveLength(2);
  });

  it("discards a protocol-corrupt child instead of reusing it", async () => {
    const fixture = spawnFixture((child, index) => {
      if (index === 0) {
        child.stdin.once("data", () => {
          child.stdout.write(JSON.stringify({ protocolVersion: 1, requestId: "wrong", ok: true, result: {} }) + "\n");
        });
      } else {
        respondToRequests(child, () => ({ generation: 2 }));
      }
    });
    const runtime = supervisor(fixture.spawn);

    await expect(runtime.request("health", {})).rejects.toMatchObject({ code: "COMPUTER_PROTOCOL_INVALID" });
    expect(fixture.children[0]?.killed).toBe(true);
    await expect(runtime.request("health", {})).resolves.toEqual({ generation: 2 });
  });

  it("keeps only a bounded diagnostic stderr tail and never uses it as a public request error", async () => {
    const fixture = spawnFixture();
    const runtime = supervisor(fixture.spawn, { stderrLimitBytes: 16 });
    const pending = runtime.request("health", {});
    await new Promise((resolve) => setImmediate(resolve));
    fixture.children[0]!.stderr.write("SECRET-" + "x".repeat(30));
    fixture.children[0]!.emit("close", 1, null);

    await expect(pending).rejects.toMatchObject({
      code: "COMPUTER_UNAVAILABLE",
      message: "Computer Runtime is unavailable.",
    });
    const diagnostics = runtime.diagnosticStderr();
    expect(diagnostics.bytes).toBe(16);
    expect(diagnostics.truncated).toBe(true);
    expect(diagnostics.content).not.toContain("SECRET-");
  });

  it("close is idempotent and permanently prevents lazy restart", async () => {
    const fixture = spawnFixture((child) => respondToRequests(child, () => ({ state: "running" })));
    const runtime = supervisor(fixture.spawn);
    await runtime.request("health", {});

    await runtime.close();
    await runtime.close();
    await expect(runtime.request("health", {})).rejects.toMatchObject({ code: "COMPUTER_UNAVAILABLE" });
    expect(fixture.calls).toHaveLength(1);
  });
});
