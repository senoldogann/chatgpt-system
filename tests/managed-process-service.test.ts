import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { ManagedProcessService } from "../src/managed-process-service.js";
import { PathPolicy } from "../src/policy.js";
import { ProcessSupervisor } from "../src/process-supervisor.js";

const cleanups: string[] = [];
const supervisors: ProcessSupervisor[] = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((item) => item.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture(stopGraceMs = 200) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-managed-process-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  const sibling = path.join(base, "sibling");
  await mkdir(root);
  await mkdir(sibling);
  const supervisor = new ProcessSupervisor({
    limits: {
      maxManagedProcesses: 8,
      maxProcessLogBytesPerStream: 4096,
      processStopGraceMs: stopGraceMs,
    },
    audit: new AuditLogger(path.join(base, "audit.jsonl")),
  });
  supervisors.push(supervisor);
  const admin = new ManagedProcessService(new PathPolicy([root]), { enabled: true, commands: ["node"] }, supervisor);
  const secondAdmin = new ManagedProcessService(new PathPolicy([root]), { enabled: true, commands: ["node"] }, supervisor);
  const user = new ManagedProcessService(new PathPolicy([root]), { enabled: false, commands: [] }, supervisor);
  return { root, sibling, supervisor, admin, secondAdmin, user };
}

async function waitForLog(service: ManagedProcessService, processId: string, text: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await service.logs(processId)).stdout.content.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${text}`);
}

describe("ManagedProcessService", () => {
  it("enforces terminal, command and cwd scope without exposing hidden records", async () => {
    const { root, sibling, admin, secondAdmin, user } = await fixture();

    await expect(user.start("node", ["--version"], root)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(admin.start("sh", ["-c", "echo nope"], root)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(admin.start("/usr/bin/node", ["--version"], root)).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(admin.start("node", ["--version"], sibling)).rejects.toMatchObject({ code: "POLICY_DENIED" });

    const started = await admin.start("node", ["-e", "console.log('process-ready'); setInterval(() => {}, 1000)"], root);
    expect(started.processId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(JSON.stringify(started)).not.toContain("pid");
    await waitForLog(admin, started.processId, "process-ready");

    expect(await user.list()).toEqual({ processes: [] });
    await expect(user.status(started.processId)).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" });
    await expect(user.logs(started.processId)).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" });
    await expect(user.stop(started.processId)).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" });
    await expect(admin.status("x".repeat(43))).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" });

    expect((await secondAdmin.status(started.processId)).state).toBe("running");
    const stopped = await secondAdmin.stop(started.processId);
    expect(stopped.state).toBe("stopped");
    expect((await secondAdmin.stop(started.processId)).state).toBe("stopped");
  });

    it("escalates an uncooperative process from SIGTERM to SIGKILL", async () => {    const { root, admin } = await fixture(50);
    const started = await admin.start(
      "node",
      ["-e", "process.on('SIGTERM', () => {}); console.log('ignoring-term'); setInterval(() => {}, 1000)"],
      root,
    );
    await waitForLog(admin, started.processId, "ignoring-term");

    const stopped = await admin.stop(started.processId);
    expect(stopped.state).toBe("stopped");
    expect(stopped.signal).toBe("SIGKILL");
  });

  it("returns a structured executable-not-found error for allowlisted but missing binaries", async () => {
    const { root, supervisor } = await fixture();
    const scoped = new ManagedProcessService(
      new PathPolicy([root]),
      { enabled: true, commands: ["node", "chatgpt-system-missing-binary-xyz"] },
      supervisor,
    );

    await expect(scoped.start("chatgpt-system-missing-binary-xyz", [], root)).rejects.toMatchObject({
      code: "EXECUTABLE_NOT_FOUND",
      details: {
        command: "chatgpt-system-missing-binary-xyz",
        allowed: true,
        available: false,
      },
    });
    expect(supervisor.descriptors()).toEqual([]);
  });
});
