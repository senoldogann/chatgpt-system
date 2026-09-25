import { mkdtemp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/core/audit.js";
import { ConflictError, LimitError, ProcessIdentityUnverifiedError } from "../src/core/errors.js";
import {
  ProcessSupervisor,
  type ManagedProcessState,
} from "../src/process/process-supervisor.js";

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

async function waitForLogText(
  supervisor: ProcessSupervisor,
  processId: string,
  expected: string,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (supervisor.logs(processId)?.stdout.content.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process ${processId} did not report readiness`);
}

async function waitForPath(file: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("process control socket did not become ready");
}

async function fixture(options: {
  maxManagedProcesses?: number;
  maxProcessLogBytesPerStream?: number;
  processStopGraceMs?: number;
  now?: () => number;
  newProcessId?: () => string;
  persistencePath?: string;
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
    ...(options.persistencePath ? { persistencePath: options.persistencePath } : {}),
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

  it("reattaches a running persistent job after a daemon-like supervisor restart and preserves output cursor state", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const first = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 1024, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-first.jsonl")),
      persistencePath,
    });
    supervisors.push(first);
    const started = await first.start({
      command: "node",
      args: ["-e", "process.stdout.write('one'); setTimeout(() => { process.stdout.write('two'); }, 120); setTimeout(() => {}, 10000)"],
      cwd: base,
      idempotencyKey: "restart-job-1",
    });
    expect(started.status).toBe("running");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await first.close(true);

    const second = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 1024, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-second.jsonl")),
      persistencePath,
    });
    supervisors.push(second);
    expect(second.status(started.processId)).toMatchObject({ processId: started.processId, state: "running", jobId: started.processId });
    let firstChunk = second.logs(started.processId, 0);
    for (let attempt = 0; attempt < 100 && !firstChunk?.stdout.content.includes("one"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      firstChunk = second.logs(started.processId, 0);
    }
    expect(firstChunk?.stdout.content).toContain("one");
    expect(firstChunk?.stdout.nextCursor).toBeTypeOf("number");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const next = second.logs(started.processId, firstChunk?.stdout.nextCursor);
    expect(next?.stdout.content).toContain("two");

    const duplicate = await second.start({ command: "node", args: ["-e", "process.stdout.write('one'); setTimeout(() => { process.stdout.write('two'); }, 120); setTimeout(() => {}, 10000)"], cwd: base, idempotencyKey: "restart-job-1" });
    expect(duplicate.processId).toBe(started.processId);
    await expect(second.start({ command: "node", args: ["-e", "different"], cwd: base, idempotencyKey: "restart-job-1" })).rejects.toBeInstanceOf(ConflictError);
    await second.stop(started.processId);
  });

  it("keeps logical cursors monotonic across physical log truncation, restart, and separate streams", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const releasePath = path.join(base, "release-final-chunk");
    const supervisor = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 5, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit.jsonl")),
      persistencePath,
    });
    supervisors.push(supervisor);
    const started = await supervisor.start({
      command: "node",
      args: ["-e", `const fs = require('node:fs'); const release = ${JSON.stringify(releasePath)}; process.stdout.write('AAAAA'); process.stderr.write('11111'); process.stdout.write('BBBBB'); process.stderr.write('22222'); const gate = setInterval(() => { if (!fs.existsSync(release)) return; clearInterval(gate); process.stdout.write('CCCCC'); process.stderr.write('33333'); }, 10); setTimeout(() => {}, 10000);`],
      cwd: base,
    });
    let first = supervisor.logs(started.processId, 0)!;
    for (let attempt = 0; attempt < 500 && (first.stdout.nextCursor ?? 0) <= first.stdout.bytes; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      first = supervisor.logs(started.processId, 0)!;
    }
    const firstCursor = first.stdout.nextCursor!;
    expect(firstCursor).toBeGreaterThan(first.stdout.bytes);
    // Release the final write only after reading the earlier cursor: timers can all
    // expire before the first poll under CI load, making 15 > 15 impossible.
    await writeFile(releasePath, "release");
    let second = supervisor.logs(started.processId, firstCursor)!;
    for (let attempt = 0; attempt < 150 && !(second.stdout.content.includes("CCCCC") && second.stderr.content.includes("33333")); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      second = supervisor.logs(started.processId, firstCursor)!;
    }
    expect(second.stdout.nextCursor).toBeGreaterThan(firstCursor);
    expect(second.stdout.content).toContain("CCCCC");
    expect(second.stderr.nextCursor).toBeGreaterThan(first.stderr.nextCursor!);
    expect(second.stderr.content).toContain("33333");
    const restarted = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 5, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-restarted.jsonl")),
      persistencePath,
    });
    supervisors.push(restarted);
    const afterRestart = restarted.logs(started.processId, 0)!;
    expect(afterRestart.stdout.nextCursor).toBe(second.stdout.nextCursor);
    expect(afterRestart.stdout.truncated).toBe(true);
  });

  it("preserves the independent wrapper exit code after the daemon-like supervisor closes", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const first = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-first.jsonl")),
      persistencePath,
    });
    supervisors.push(first);
    const started = await first.start({ command: "node", args: ["-e", "process.exit(23)"], cwd: base });
    await first.close(true);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const second = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-second.jsonl")),
      persistencePath,
    });
    supervisors.push(second);
    expect(second.status(started.processId)).toMatchObject({ state: "exited", status: "failed", exitCode: 23, signal: null });
  });

  it("keeps an ACK-only cancellation in stopping state until a verified result arrives", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const first = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-first.jsonl")),
      persistencePath,
    });
    supervisors.push(first);
    const started = await first.start({ command: "node", args: ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('READY'); setTimeout(() => process.exit(0), 350)"], cwd: base });
    await first.close(true);
    const second = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 100, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-second.jsonl")),
      persistencePath,
    });
    supervisors.push(second);
    // The control socket starts before the child installs its SIGTERM handler.
    // Wait for application readiness so this tests ACK/result handling, not startup timing.
    await waitForLogText(second, started.processId, "READY");
    const requested = await second.stop(started.processId);
    expect(requested).toMatchObject({ state: "stopping", status: "stopping" });
    const completed = await waitForState(second, started.processId, "exited", 3_000);
    expect(completed).toMatchObject({ state: "exited", status: "completed", exitCode: 0, signal: null });
  });

  it("reports control-channel loss separately and keeps the job running", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const first = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-first.jsonl")),
      persistencePath,
    });
    supervisors.push(first);
    const started = await first.start({ command: "node", args: ["-e", "setTimeout(() => process.exit(0), 1500)"], cwd: base });
    await first.close(true);
    const second = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-second.jsonl")),
      persistencePath,
    });
    supervisors.push(second);
    const internal = (second as unknown as { records: Map<string, { controlPath?: string }> }).records.get(started.processId)!;
    // The wrapper creates its control socket asynchronously after start() acknowledges spawn.
    await waitForPath(internal.controlPath!);
    await unlink(internal.controlPath!);
    await expect(second.stop(started.processId)).rejects.toMatchObject({ code: "PROCESS_CONTROL_UNAVAILABLE" });
    expect(second.status(started.processId)?.state).toBe("running");
  });

  it("enforces a physical log quota and quarantines corrupt metadata", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const supervisor = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 7, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit.jsonl")),
      persistencePath,
    });
    supervisors.push(supervisor);
    const started = await supervisor.start({ command: "node", args: ["-e", "process.stdout.write('0123456789abcdef'); process.stderr.write('abcdefghijk')"], cwd: base });
    // start() acknowledges wrapper spawn before log files exist; terminal state proves
    // the wrapper completed initialization and flushed its bounded streams.
    await waitForState(supervisor, started.processId, "exited", 3_000);
    expect((await stat(path.join(persistencePath, `${started.processId}.stdout.log`))).size).toBeLessThanOrEqual(7);
    expect((await stat(path.join(persistencePath, `${started.processId}.stderr.log`))).size).toBeLessThanOrEqual(7);

    await writeFile(path.join(persistencePath, "broken.json"), "{not-json", "utf8");
    const recovered = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 7, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-recovered.jsonl")),
      persistencePath,
    });
    supervisors.push(recovered);
    expect((await readdir(persistencePath)).some((name) => name.startsWith("broken.json.corrupt-"))).toBe(true);
  });

  it("preserves the real wrapper result across separate daemon processes", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daemon-restart-"));
    cleanups.push(base);
    const persistencePath = path.join(base, "processes");
    const supervisorModule = path.resolve("dist/process/process-supervisor.js");
    const limits = "{ maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 }";
    const runDaemon = (script: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: base, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    const first = await runDaemon(`import { ProcessSupervisor } from ${JSON.stringify(supervisorModule)}; const s = new ProcessSupervisor({ limits: ${limits}, audit: { record: async () => {} }, persistencePath: ${JSON.stringify(persistencePath)} }); const r = await s.start({ command: "node", args: ["-e", "setTimeout(() => process.exit(19), 180)"], cwd: ${JSON.stringify(base)} }); console.log(r.processId);`);
    expect(first.code).toBe(0);
    const processId = first.stdout.trim();
    expect(processId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const second = await runDaemon(`import { ProcessSupervisor } from ${JSON.stringify(supervisorModule)}; const s = new ProcessSupervisor({ limits: ${limits}, audit: { record: async () => {} }, persistencePath: ${JSON.stringify(persistencePath)} }); console.log(JSON.stringify(s.status(${JSON.stringify(processId)})));`);
    expect(second.code).toBe(0);
    expect(JSON.parse(second.stdout.trim())).toMatchObject({ processId, state: "exited", exitCode: 19, signal: null, status: "failed" });
  });

  it("recovers the wrapper result in the same second daemon after reconnecting while running", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daemon-reconnect-"));
    cleanups.push(base);
    const persistencePath = path.join(base, "processes");
    const supervisorModule = path.resolve("dist/process/process-supervisor.js");
    const limits = "{ maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 }";
    const runDaemon = (script: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: base, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    const releasePath = path.join(base, "release-child");
    const readyPath = path.join(base, "reconnected-daemon-ready");
    // A real file handshake proves the recovered daemon observed the still-running child
    // before the test lets that child exit. Fixed 10/15-second timers were load-sensitive.
    const childScript = `const fs = require("node:fs"); const release = ${JSON.stringify(releasePath)}; const timer = setInterval(() => { if (fs.existsSync(release)) { clearInterval(timer); process.exit(29); } }, 20); setTimeout(() => process.exit(99), 20000);`;
    const first = await runDaemon(`import { ProcessSupervisor } from ${JSON.stringify(supervisorModule)}; const s = new ProcessSupervisor({ limits: ${limits}, audit: { record: async () => {} }, persistencePath: ${JSON.stringify(persistencePath)} }); const r = await s.start({ command: "node", args: ["-e", ${JSON.stringify(childScript)}], cwd: ${JSON.stringify(base)} }); console.log(r.processId); await s.close(true);`);
    expect(first.code).toBe(0);
    const processId = first.stdout.trim();
    const secondPromise = runDaemon(`import { writeFileSync } from "node:fs"; import { ProcessSupervisor } from ${JSON.stringify(supervisorModule)}; const s = new ProcessSupervisor({ limits: ${limits}, audit: { record: async () => {} }, persistencePath: ${JSON.stringify(persistencePath)} }); const initial = s.status(${JSON.stringify(processId)}); console.log(JSON.stringify({ phase: "initial", state: initial?.state })); if (initial?.state !== "running") process.exit(3); writeFileSync(${JSON.stringify(readyPath)}, "ready"); const timer = setInterval(() => { const current = s.status(${JSON.stringify(processId)}); if (current?.state === "exited") { console.log(JSON.stringify({ phase: "final", state: current.state, exitCode: current.exitCode, signal: current.signal })); clearInterval(timer); process.exit(0); } }, 20); setTimeout(() => process.exit(2), 15000);`);
    await waitForPath(readyPath, 5_000);
    await writeFile(releasePath, "release");
    const second = await secondPromise;
    expect(second.code).toBe(0);
    const lines = second.stdout.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual(expect.arrayContaining([
      { phase: "initial", state: "running" },
      { phase: "final", state: "exited", exitCode: 29, signal: null },
    ]));
  });

  it("recovers an authentic wrapper result that arrives after the job became unknown", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-late-result-"));
    cleanups.push(base);
    const persistencePath = path.join(base, "processes");
    const options = { limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 }, persistencePath };
    const first = new ProcessSupervisor({ ...options, audit: new AuditLogger(path.join(base, "audit-first.jsonl")) });
    supervisors.push(first);
    const started = await first.start({ command: "node", args: ["-e", "process.exit(29)"], cwd: base });
    await first.close(true);
    expect((await waitForState(first, started.processId, "exited", 5_000)).exitCode).toBe(29);
    // Observing the independent result can mark the record exited before the
    // wrapper's close handler writes its final persisted metadata. Wait for
    // that handler so it cannot overwrite the interrupted-daemon fixture.
    const firstRecord = (first as unknown as { records: Map<string, { closed: Promise<void> }> })
      .records.get(started.processId)!;
    await firstRecord.closed;

    const recordPath = path.join(persistencePath, `${started.processId}.json`);
    const resultPath = path.join(persistencePath, `${started.processId}.result.json`);
    const authenticResult = await readFile(resultPath, "utf8");
    const previous = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    // Simulate an interrupted daemon: metadata still says running and the independently
    // finalized result becomes visible just after the recovering daemon checks the PID.
    previous.state = "running";
    delete previous.exitedAt;
    delete previous.exitCode;
    delete previous.signal;
    // The wrapper can exit before its OS PID is fully reaped. Explicitly make
    // its recovered fingerprint unverifiable so the pre-result state is unknown
    // regardless of scheduling, while keeping the authentic result unchanged.
    previous.fingerprint = { source: "ps", value: "not-current" };
    await unlink(resultPath);
    await writeFile(recordPath, `${JSON.stringify(previous)}\n`, "utf8");
    const second = new ProcessSupervisor({ ...options, audit: new AuditLogger(path.join(base, "audit-second.jsonl")) });
    supervisors.push(second);
    expect(second.status(started.processId)?.state).toBe("unknown");
    await writeFile(resultPath, authenticResult, "utf8");
    expect(second.status(started.processId)).toMatchObject({ state: "exited", exitCode: 29, signal: null, status: "failed" });
  });

  it("keeps a recovered running job unknown when no independent result exists", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const first = new ProcessSupervisor({ limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 }, audit: new AuditLogger(path.join(base, "audit-first.jsonl")), persistencePath });
    supervisors.push(first);
    const started = await first.start({ command: "node", args: ["-e", "setTimeout(() => {}, 10000)"], cwd: base });
    await first.close(true);
    const recordPath = path.join(persistencePath, `${started.processId}.json`);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    record.fingerprint = { source: "ps", value: "not-current" };
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");
    const second = new ProcessSupervisor({ limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 }, audit: new AuditLogger(path.join(base, "audit-second.jsonl")), persistencePath });
    supervisors.push(second);
    expect(second.status(started.processId)?.state).toBe("unknown");
  });

  it("refuses to signal a recovered process when its fingerprint is not verifiable", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "processes");
    const first = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-first.jsonl")),
      persistencePath,
    });
    supervisors.push(first);
    const started = await first.start({ command: "node", args: ["-e", "setTimeout(() => {}, 10000)"], cwd: base });
    await first.close(true);
    const recordPath = path.join(persistencePath, `${started.processId}.json`);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    record.fingerprint = { source: "ps", value: "wrong" };
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");
    const signals: number[] = [];
    const second = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-second.jsonl")),
      persistencePath,
      signalProcess: (target) => { signals.push(target); },
    });
    supervisors.push(second);
    expect(second.status(started.processId)).toMatchObject({ state: "unknown", status: "unknown" });
    await expect(second.stop(started.processId)).rejects.toBeInstanceOf(ProcessIdentityUnverifiedError);
    expect(signals).toEqual([]);
  });

  it("deduplicates concurrent idempotent starts and rejects a conflicting request", async () => {
    const { base, supervisor } = await fixture();
    const request = { command: "node", args: ["-e", "setTimeout(() => {}, 100)"], cwd: base, idempotencyKey: "same-request" };
    const [first, second] = await Promise.all([supervisor.start(request), supervisor.start(request)]);
    expect(second.processId).toBe(first.processId);
    expect(supervisor.descriptors()).toHaveLength(1);
    await expect(supervisor.start({ command: "node", args: ["-e", "process.exit(7)"], cwd: base, idempotencyKey: "same-request" })).rejects.toBeInstanceOf(ConflictError);
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

  it("releases pending start capacity when pre-spawn preparation fails", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "blocked-persistence");
    const supervisor = new ProcessSupervisor({
      limits: { maxManagedProcesses: 2, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-pending.jsonl")),
      persistencePath,
    });
    supervisors.push(supervisor);

    // The constructor created the persistence directory; replacing it with a regular
    // file makes the pre-spawn recursive mkdir fail deterministically before spawn.
    await rm(persistencePath, { recursive: true });
    await writeFile(persistencePath, "not a directory", "utf8");

    await expect(supervisor.start({ command: "node", args: ["-e", "setTimeout(() => {}, 50)"], cwd: base })).rejects.toThrow();
    await expect(supervisor.start({ command: "node", args: ["-e", "setTimeout(() => {}, 50)"], cwd: base })).rejects.toThrow();
    expect(supervisor.descriptors()).toEqual([]);

    // Restore persistence so the next start can succeed: with a capacity leak the
    // two failed starts would have consumed the whole registry and the third start
    // would be refused with LIMIT_EXCEEDED even though no process is running.
    await rm(persistencePath, { recursive: true });
    const recovered = await supervisor.start({ command: "node", args: ["-e", "process.exit(0)"], cwd: base });
    await waitForState(supervisor, recovered.processId, "exited");
  });

  it("keeps process ownership when the post-spawn persistence write fails", async () => {
    const { base } = await fixture();
    const persistencePath = path.join(base, "collide-persistence");
    const fixedId = "K".repeat(43);
    const supervisor = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 128, processStopGraceMs: 100 },
      audit: new AuditLogger(path.join(base, "audit-persist-fail.jsonl")),
      persistencePath,
      newProcessId: () => fixedId,
    });
    supervisors.push(supervisor);

    // A directory occupying the record destination makes the post-spawn persistence
    // rename fail while every pre-spawn step still succeeds. Ownership and the start
    // result must not depend on best-effort persistence storage.
    await mkdir(path.join(persistencePath, `${fixedId}.json`), { recursive: true });

    const started = await supervisor.start({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 250)"],
      cwd: base,
    });
    expect(started.processId).toBe(fixedId);
    expect(started.status).toBe("running");
    expect(supervisor.status(fixedId)).toMatchObject({ state: "running" });

    const finished = await waitForState(supervisor, fixedId, "exited", 3_000);
    expect(finished.exitCode).toBe(0);

    // The detached wrapper performs its final persistence writes shortly after the
    // logical exit is observed. Wait for the directory to quiesce, remove the
    // collision and the whole persistence tree here, and leave afterEach nothing
    // to race against (CI showed an ENOTEMPTY rmdir in shared cleanup).
    let previousListing = "";
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const listing = (await readdir(persistencePath)).sort().join(",");
      if (listing === previousListing) break;
      previousListing = listing;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await supervisor.close();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await rm(persistencePath, { recursive: true });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  });
});

describe("ProcessSupervisor UTF-8 log cursors", () => {
  for (const persistent of [false, true]) {
    it(`never splits a multi-byte character across cursor reads (${persistent ? "persistent" : "in-memory"})`, async () => {
      const { base } = await fixture();
      const target = new ProcessSupervisor({
        limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 1024, processStopGraceMs: 50 },
        audit: new AuditLogger(path.join(base, "audit-utf8.jsonl")),
        ...(persistent ? { persistencePath: path.join(base, "processes") } : {}),
      });
      supervisors.push(target);
      const releasePath = path.join(base, "release-second-byte");
      // "é" = C3 A9: ilk bayt hemen, ikinci bayt tetik dosyası oluşunca yazılır.
      const script = [
        "process.stdout.write('ready\\n'); process.stdout.write(Buffer.from([0xc3]));",
        `const release = ${JSON.stringify(releasePath)};`,
        "const timer = setInterval(() => { if (require('fs').existsSync(release)) {",
        "  clearInterval(timer); process.stdout.write(Buffer.from([0xa9, 0x0a])); } }, 10);",
      ].join("\n");
      const started = await target.start({ command: "node", args: ["-e", script], cwd: base });
      await waitForLogText(target, started.processId, "ready");
      await new Promise((resolve) => setTimeout(resolve, 50));

      const partial = target.logs(started.processId, 0);
      expect(partial?.stdout.content).toBe("ready\n");
      expect(partial?.stdout.nextCursor).toBe(Buffer.byteLength("ready\n"));

      await writeFile(releasePath, "");
      const deadline = Date.now() + 3_000;
      let completed = target.logs(started.processId, partial?.stdout.nextCursor);
      while (Date.now() < deadline && !completed?.stdout.content.includes("\n")) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        completed = target.logs(started.processId, partial?.stdout.nextCursor);
      }
      expect(completed?.stdout.content).toBe("é\n");
    });
  }
});
