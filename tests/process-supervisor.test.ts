import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { LimitError } from "../src/errors.js";
import {
  ProcessSupervisor,
  type ManagedProcessState,
} from "../src/process-supervisor.js";

const cleanups: string[] = [];
const supervisors: ProcessSupervisor[] = [];

async function waitForState(
  supervisor: ProcessSupervisor,
  processId: string,
  expected: Exclude<ManagedProcessState, "running">,
  timeoutMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = supervisor.status(processId);
    if (status?.state === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process ${processId} did not reach ${expected}`);
}

async function fixture(options: {
  maxManagedProcesses?: number;
  maxProcessLogBytesPerStream?: number;
  processStopGraceMs?: number;
  now?: () => number;
  newProcessId?: () => string;
} = {}) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-supervisor-"));
  cleanups.push(base);
  const supervisor = new ProcessSupervisor({
    limits: {
      maxManagedProcesses: options.maxManagedProcesses ?? 4,
      maxProcessLogBytesPerStream: options.maxProcessLogBytesPerStream ?? 1024,
      processStopGraceMs: options.processStopGraceMs ?? 50,
    },
    audit: new AuditLogger(path.join(base, "audit.jsonl")),
    ...(options.now ? { now: options.now } : {}),
    ...(options.newProcessId ? { newProcessId: options.newProcessId } : {}),
  });
  supervisors.push(supervisor);
  return { base, supervisor };
}

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("ProcessSupervisor core", () => {
  it("starts a child with an opaque public id and never exposes an OS pid", async () => {
    const { base, supervisor } = await fixture();
    const started = await supervisor.start({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 80)"],
      cwd: base,
    });

    expect(started.processId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(started.command).toBe("node");
    expect(started.argCount).toBe(2);
    expect(started.cwd).toBe(base);
    expect(JSON.stringify(started)).not.toMatch(/\bpid\b/i);

    await waitForState(supervisor, started.processId, "exited");
  });

  it("does not register a process when spawn fails before success", async () => {
    const { base, supervisor } = await fixture();

    await expect(supervisor.start({
      command: "chatgpt-system-command-that-does-not-exist",
      args: [],
      cwd: base,
    })).rejects.toBeInstanceOf(Error);

    expect(supervisor.descriptors()).toEqual([]);
  });

  it("records natural exit state, exit code, and close time", async () => {
    const { base, supervisor } = await fixture();
    const started = await supervisor.start({
      command: "node",
      args: ["-e", "process.exit(7)"],
      cwd: base,
    });

    const exited = await waitForState(supervisor, started.processId, "exited");
    expect(exited).toMatchObject({
      processId: started.processId,
      state: "exited",
      exitCode: 7,
      signal: null,
    });
    expect(exited.exitedAt).toEqual(expect.any(String));
  });

  it("keeps independent bounded stdout/stderr tails and marks truncation", async () => {
    const { base, supervisor } = await fixture({ maxProcessLogBytesPerStream: 5 });
    const started = await supervisor.start({
      command: "node",
      args: [
        "-e",
        "process.stdout.write('abcdefghij'); process.stderr.write('uvwxyz')",
      ],
      cwd: base,
    });

    await waitForState(supervisor, started.processId, "exited");
    expect(supervisor.logs(started.processId)).toEqual({
      processId: started.processId,
      stdout: { content: "fghij", bytes: 5, truncated: true },
      stderr: { content: "vwxyz", bytes: 5, truncated: true },
    });
  });

  it("never evicts running records when the registry is full", async () => {
    const ids = ["A".repeat(43), "B".repeat(43)];
    const { base, supervisor } = await fixture({
      maxManagedProcesses: 1,
      newProcessId: () => ids.shift()!,
    });
    const first = await supervisor.start({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 150)"],
      cwd: base,
    });

    await expect(supervisor.start({
      command: "node",
      args: ["-e", "process.exit(0)"],
      cwd: base,
    })).rejects.toBeInstanceOf(LimitError);

    expect(supervisor.status(first.processId)?.state).toBe("running");
    await waitForState(supervisor, first.processId, "exited");
  });

  it("evicts the oldest completed record first when capacity is needed", async () => {
    const ids = ["A".repeat(43), "B".repeat(43), "C".repeat(43)];
    let now = 1_000;
    const { base, supervisor } = await fixture({
      maxManagedProcesses: 2,
      now: () => ++now,
      newProcessId: () => ids.shift()!,
    });

    const first = await supervisor.start({
      command: "node",
      args: ["-e", "process.exit(0)"],
      cwd: base,
    });
    await waitForState(supervisor, first.processId, "exited");

    const second = await supervisor.start({
      command: "node",
      args: ["-e", "process.exit(0)"],
      cwd: base,
    });
    await waitForState(supervisor, second.processId, "exited");

    const third = await supervisor.start({
      command: "node",
      args: ["-e", "process.exit(0)"],
      cwd: base,
    });
    await waitForState(supervisor, third.processId, "exited");

    expect(supervisor.status(first.processId)).toBeUndefined();
    expect(supervisor.status(second.processId)).toBeDefined();
    expect(supervisor.status(third.processId)).toBeDefined();
    expect(supervisor.descriptors().map((item) => item.processId)).toEqual([
      second.processId,
      third.processId,
    ]);
  });
});
