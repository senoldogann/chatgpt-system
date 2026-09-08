import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { ProcessSupervisor } from "../src/process-supervisor.js";

const cleanups: string[] = [];
const supervisors: ProcessSupervisor[] = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((item) => item.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("managed process audit privacy", () => {
  it("records lifecycle metadata without process IDs, args, env or logs", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-process-audit-"));
    cleanups.push(base);
    const root = path.join(base, "root");
    await mkdir(root);
    const auditFile = path.join(base, "audit.jsonl");
    const supervisor = new ProcessSupervisor({
      limits: { maxManagedProcesses: 4, maxProcessLogBytesPerStream: 4096, processStopGraceMs: 100 },
      audit: new AuditLogger(auditFile),
    });
    supervisors.push(supervisor);

    const started = await supervisor.start({
      command: "node",
      args: [
        "-e",
        "console.log('SECRET_OUTPUT_SENTINEL'); setInterval(() => {}, 1000)",
        "SECRET_ARGUMENT_SENTINEL",
      ],
      cwd: root,
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (supervisor.logs(started.processId)?.stdout.content.includes("SECRET_OUTPUT_SENTINEL")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await supervisor.stop(started.processId);

    const raw = await readFile(auditFile, "utf8");
    expect(raw).not.toContain(started.processId);
    expect(raw).not.toContain("SECRET_ARGUMENT_SENTINEL");
    expect(raw).not.toContain("SECRET_OUTPUT_SENTINEL");
    expect(raw).not.toMatch(/"pid"\s*:/);

    const events = raw.trim().split("\n").map((line) => JSON.parse(line) as {
      action: string;
      metadata?: Record<string, unknown>;
    });
    const start = events.find((event) => event.action === "process.start");
    const stop = events.find((event) => event.action === "process.stop");
    expect(start?.metadata).toEqual({ command: "node", argCount: 3, state: "running" });
    expect(stop?.metadata).toMatchObject({ command: "node", argCount: 3, state: "stopped" });
  });
});
