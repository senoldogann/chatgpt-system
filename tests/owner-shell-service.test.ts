import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { OwnerShellService } from "../src/owner-shell-service.js";
import { OwnerShellSupervisor } from "../src/owner-shell-supervisor.js";
import { PathPolicy } from "../src/policy.js";

const cleanups: string[] = [];

async function fixture(options: { admin: boolean; enabled: boolean; retainedBytes?: number }) {
  const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-shell-"));
  cleanups.push(root);
  const supervisor = new OwnerShellSupervisor({
    maxRetainedBytesPerStream: options.retainedBytes ?? 4096,
    processStopGraceMs: 30,
  });
  const service = new OwnerShellService(
    new PathPolicy([root]),
    new AuditLogger(path.join(root, "audit.jsonl")),
    supervisor,
    { enabled: options.enabled, shellPath: "/bin/sh", maxScriptBytes: 262_144 },
    options.admin,
  );
  return { root, service, supervisor };
}

afterEach(async () => {
  delete process.env.CONTROL_PLANE_API_KEY;
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("OwnerShellService", () => {
  it("denies Project/User-style scopes before execution", async () => {
    const { service, supervisor } = await fixture({ admin: false, enabled: true });
    try {
      await expect(service.run({ script: "printf no" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    } finally {
      await supervisor.close();
    }
  });

  it("denies Admin when the Owner Runtime startup gate is disabled", async () => {
    const { service, supervisor } = await fixture({ admin: true, enabled: false });
    try {
      await expect(service.run({ script: "printf no" })).rejects.toMatchObject({ code: "OWNER_RUNTIME_DISABLED" });
    } finally {
      await supervisor.close();
    }
  });

  it("runs arbitrary shell syntax and absolute executables outside terminal allowlists", async () => {
    const { root, service, supervisor } = await fixture({ admin: true, enabled: true });
    const executable = path.join(root, "not-allowlisted-tool");
    await writeFile(executable, "#!/bin/sh\nprintf 'CUSTOM'\n", "utf8");
    await chmod(executable, 0o755);
    try {
      const result = await service.run({
        cwd: root,
        script: `printf 'alpha' | tr a-z A-Z; printf 'file-ok' > redirected.txt; "${executable}"`,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ALPHACUSTOM");
      expect(await readFile(path.join(root, "redirected.txt"), "utf8")).toBe("file-ok");
    } finally {
      await supervisor.close();
    }
  });

  it("truncates retained output without terminating a successful command", async () => {
    const { root, service, supervisor } = await fixture({ admin: true, enabled: true, retainedBytes: 32 });
    try {
      const result = await service.run({
        cwd: root,
        script: "i=0; while [ $i -lt 200 ]; do printf x; i=$((i+1)); done",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdoutBytesSeen).toBe(200);
      expect(result.stdoutTruncated).toBe(true);
    } finally {
      await supervisor.close();
    }
  });

  it("does not inherit daemon-only environment values", async () => {
    process.env.CONTROL_PLANE_API_KEY = "owner-shell-secret-canary";
    const { root, service, supervisor } = await fixture({ admin: true, enabled: true });
    try {
      const result = await service.run({
        cwd: root,
        script: "printf '%s' \"${CONTROL_PLANE_API_KEY-unset}\"",
      });
      expect(result.stdout).toBe("unset");
    } finally {
      await supervisor.close();
    }
  });

  it("has no implicit legacy command timeout when timeoutMs is omitted", async () => {
    const { root, service, supervisor } = await fixture({ admin: true, enabled: true });
    try {
      const result = await service.run({ cwd: root, script: "sleep 0.12; printf done" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("done");
      expect(result.timedOut).toBe(false);
    } finally {
      await supervisor.close();
    }
  });

  it("rejects invalid or oversized scripts before execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-owner-shell-limit-"));
    cleanups.push(root);
    const supervisor = new OwnerShellSupervisor({ maxRetainedBytesPerStream: 128, processStopGraceMs: 30 });
    const service = new OwnerShellService(
      new PathPolicy([root]),
      new AuditLogger(path.join(root, "audit.jsonl")),
      supervisor,
      { enabled: true, shellPath: "/bin/sh", maxScriptBytes: 4 },
      true,
    );
    try {
      await expect(service.run({ script: "" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(service.run({ script: "a\u0000b" })).rejects.toMatchObject({ code: "POLICY_DENIED" });
      await expect(service.run({ script: "12345" })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    } finally {
      await supervisor.close();
    }
  });
});
