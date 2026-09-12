import { describe, expect, it } from "vitest";
import { OwnerShellSupervisor } from "../src/owner-shell-supervisor.js";

const shellPath = "/bin/sh";

function runInput(script: string, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  return {
    shellPath,
    script,
    cwd: process.cwd(),
    ...extra,
  };
}

describe("OwnerShellSupervisor", () => {
  it("retains only a bounded stdout tail without killing the process for output volume", async () => {
    const supervisor = new OwnerShellSupervisor({
      maxRetainedBytesPerStream: 32,
      processStopGraceMs: 50,
    });
    try {
      const result = await supervisor.run(runInput("i=0; while [ $i -lt 200 ]; do printf x; i=$((i+1)); done"));
      expect(result.exitCode).toBe(0);
      expect(result.stdoutBytesSeen).toBe(200);
      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32);
      expect(result.stdoutTruncated).toBe(true);
      expect(result.timedOut).toBe(false);
    } finally {
      await supervisor.close();
    }
  });

  it("treats an explicit timeout as a structured execution outcome and cleans up the process group", async () => {
    const supervisor = new OwnerShellSupervisor({
      maxRetainedBytesPerStream: 1024,
      processStopGraceMs: 30,
    });
    try {
      const started = Date.now();
      const result = await supervisor.run(runInput("sleep 5", { timeoutMs: 40 }));
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.signal).toMatch(/^SIG/);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await supervisor.close();
    }
  });

  it("rejects with SHELL_CANCELLED only after abort cleanup", async () => {
    const supervisor = new OwnerShellSupervisor({
      maxRetainedBytesPerStream: 1024,
      processStopGraceMs: 30,
    });
    const controller = new AbortController();
    const run = supervisor.run(runInput("sleep 5", { signal: controller.signal }));
    setTimeout(() => controller.abort(), 30);

    await expect(run).rejects.toMatchObject({
      code: "SHELL_CANCELLED",
      details: { reason: "abort" },
    });
    await supervisor.close();
  });

  it("rejects active work as shutdown cancellation when the shared supervisor closes", async () => {
    const supervisor = new OwnerShellSupervisor({
      maxRetainedBytesPerStream: 1024,
      processStopGraceMs: 30,
    });
    const run = supervisor.run(runInput("sleep 5"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    await supervisor.close();

    await expect(run).rejects.toMatchObject({
      code: "SHELL_CANCELLED",
      details: { reason: "shutdown" },
    });
  });

  it("surfaces process-group signaling failures as SHELL_FAILED instead of an unhandled rejection", async () => {
    const supervisor = new OwnerShellSupervisor({
      maxRetainedBytesPerStream: 1024,
      processStopGraceMs: 20,
      signalProcess: () => {
        throw Object.assign(new Error("signal denied"), { code: "EPERM" });
      },
    });

    await expect(supervisor.run(runInput("sleep 0.08", { timeoutMs: 10 }))).rejects.toMatchObject({
      code: "SHELL_FAILED",
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("escalates to SIGKILL when the owned process group ignores SIGTERM", async () => {
    const supervisor = new OwnerShellSupervisor({
      maxRetainedBytesPerStream: 1024,
      processStopGraceMs: 20,
    });
    try {
      const result = await supervisor.run(runInput("trap '' TERM; while :; do sleep 1; done", { timeoutMs: 30 }));
      expect(result.timedOut).toBe(true);
      expect(result.signal).toBe("SIGKILL");
    } finally {
      await supervisor.close();
    }
  });
});
