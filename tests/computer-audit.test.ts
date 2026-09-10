import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { ComputerError } from "../src/computer-errors.js";
import {
  ComputerNativeSupervisor,
  type ComputerSpawn,
} from "../src/computer-native-supervisor.js";
import { ComputerRuntime } from "../src/computer-runtime.js";
import type { ComputerAction, ComputerRunResult } from "../src/computer-types.js";
import { loadConfig } from "../src/config.js";
import { createRuntimeServices } from "../src/server.js";
import { createScopedRuntime } from "../src/scoped-runtime.js";
import { ScopedComputerService, type ScopedComputerBackend } from "../src/scoped-computer-service.js";
import { ScopedComputerJsService } from "../src/scoped-computer-js-service.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

class FakeComputerBackend implements ScopedComputerBackend {
  readonly calls: Array<{ method: string; input?: unknown }> = [];
  failMethod?: string;

  private call(method: string, input?: unknown): unknown {
    this.calls.push({ method, ...(input !== undefined ? { input } : {}) });
    if (this.failMethod === method) {
      throw new Error("NATIVE_STDERR_CANARY REQUEST_ID_CANARY LEASE_ID_CANARY");
    }
    if (method === "health") {
      return {
        enabled: true,
        state: "running" as const,
        accessibilityTrusted: true,
        screenCaptureAuthorized: true,
        eventListenAuthorized: true,
        eventPostAuthorized: true,
        fullHostJsEnabled: false as const,
      };
    }
    if (method === "screenshot") return { pngBase64: "aQ==", width: 1, height: 1 };
    if (method === "run") {
      const actionCount = (input as { actions: ComputerAction[] }).actions.length;
      return {
        state: "completed",
        completedCount: actionCount,
        actionCount,
        steps: [],
      } satisfies ComputerRunResult;
    }
    return { state: "completed" };
  }

  async health() { return this.call("health") as never; }
  async observe() { return this.call("observe"); }
  async screenshot() { return this.call("screenshot") as never; }
  async pointerPosition() { return this.call("pointerPosition"); }
  async listApps() { return this.call("listApps"); }
  async activeWindow() { return this.call("activeWindow"); }
  async openApp(input: never) { return this.call("openApp", input); }
  async focusApp(input: never) { return this.call("focusApp", input); }
  async moveMouse(input: never) { return this.call("moveMouse", input); }
  async click(input: never) { return this.call("click", input); }
  async drag(input: never) { return this.call("drag", input); }
  async scroll(input: never) { return this.call("scroll", input); }
  async typeText(input: never) { return this.call("typeText", input); }
  async pressKey(input: never) { return this.call("pressKey", input); }
  async waitForFrontmost(input: never) { return this.call("waitForFrontmost", input); }
  async waitForText(input: never) { return this.call("waitForText", input); }
  async waitUntilChanged(input: never) { return this.call("waitUntilChanged", input); }
  async releaseInputs() { return this.call("releaseInputs"); }
  async run(input: { actions: ComputerAction[]; finalObservation?: "none" | "active_window" | "observe"; timeoutMs?: number }) {
    return this.call("run", input) as ComputerRunResult;
  }
  async close(): Promise<void> { this.call("close"); }
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-computer-audit-"));
  cleanups.push(base);
  const auditFile = path.join(base, "audit.jsonl");
  return { base, auditFile, audit: new AuditLogger(auditFile) };
}

function parseAuditJsonl(log: string): unknown[] {
  return log.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

function expectAuditToExcludeKeys(records: unknown[], forbiddenKeys: ReadonlySet<string>): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, child] of Object.entries(value)) {
      expect(forbiddenKeys.has(key), `forbidden audit key: ${key}`).toBe(false);
      visit(child);
    }
  };
  records.forEach(visit);
}

describe("ScopedComputerService policy and audit", () => {
  it("denies non-Admin scopes before touching the shared computer runtime and allows Admin", async () => {
    const { audit } = await fixture();
    const backend = new FakeComputerBackend();

    const project = new ScopedComputerService(backend, audit, false);
    await expect(project.observe()).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(backend.calls).toHaveLength(0);

    const admin = new ScopedComputerService(backend, audit, true);
    await expect(admin.observe()).resolves.toEqual({ state: "completed" });
    expect(backend.calls.map((call) => call.method)).toEqual(["observe"]);
  });

  it("records useful computer metadata without typed text wait text coordinates lease ids request ids or native errors", async () => {
    const { auditFile, audit } = await fixture();
    const backend = new FakeComputerBackend();
    const service = new ScopedComputerService(backend, audit, true);

    await service.typeText({ text: "SECRET_TYPED_CANARY", name: "Example" });
    await service.waitForText({ text: "SECRET_WAIT_CANARY", timeoutMs: 100 });
    await service.moveMouse({ x: 91827, y: 73645 });
    await service.run({ actions: [{ type: "pointer_position" }], finalObservation: "none" });

    backend.failMethod = "observe";
    await expect(service.observe()).rejects.toThrow("NATIVE_STDERR_CANARY");

    const log = await readFile(auditFile, "utf8");
    for (const forbidden of [
      "SECRET_TYPED_CANARY",
      "SECRET_WAIT_CANARY",
      "NATIVE_STDERR_CANARY",
      "REQUEST_ID_CANARY",
      "LEASE_ID_CANARY",
      "91827",
      "73645",
    ]) {
      expect(log).not.toContain(forbidden);
    }
    expectAuditToExcludeKeys(
      parseAuditJsonl(log),
      new Set([
        "authorityLeaseId",
        "leaseId",
        "requestId",
        "x",
        "y",
        "width",
        "height",
        "from",
        "to",
        "point",
        "pointer",
        "bounds",
        "region",
        "coordinates",
      ]),
    );
    expect(log).toContain('"action":"computer.type_text"');
    expect(log).toContain('"action":"computer.wait_for_text"');
    expect(log).toContain('"action":"computer.move_mouse"');
    expect(log).toContain('"action":"computer.run"');
    expect(log).toContain('"actionCount":1');
    expect(log).toContain('"outcome":"error"');
    expect(log).toContain('"errorCode":"INTERNAL_ERROR"');
  });

  it("never copies ComputerError details into audit metadata", async () => {
    const { auditFile, audit } = await fixture();
    const backend = new FakeComputerBackend();
    backend.observe = async () => {
      throw new ComputerError("COMPUTER_ACTION_FAILED", {
        requestId: "REQUEST_ID_CANARY",
        typedText: "SECRET_TYPED_CANARY",
      });
    };
    const service = new ScopedComputerService(backend, audit, true);

    await expect(service.observe()).rejects.toMatchObject({ code: "COMPUTER_ACTION_FAILED" });
    const log = await readFile(auditFile, "utf8");
    expect(log).toContain('"errorCode":"COMPUTER_ACTION_FAILED"');
    expect(log).not.toContain("REQUEST_ID_CANARY");
    expect(log).not.toContain("SECRET_TYPED_CANARY");
  });

  it("records computer.run_js without source cwd output result or runner diagnostics", async () => {
    const { auditFile, audit } = await fixture();
    const source = "SOURCE_SECRET_CANARY";
    const cwd = "/tmp/CWD_SECRET_CANARY";
    const service = new ScopedComputerJsService({
      run: async () => ({
        stdout: "STDOUT_SECRET_CANARY",
        stderr: "STDERR_SECRET_CANARY",
        result: { secret: "RESULT_SECRET_CANARY" },
      }),
    }, audit, true, true);

    await expect(service.run({ source, cwd })).resolves.toEqual({
      stdout: "STDOUT_SECRET_CANARY",
      stderr: "STDERR_SECRET_CANARY",
      result: { secret: "RESULT_SECRET_CANARY" },
    });

    const failing = new ScopedComputerJsService({
      run: async () => {
        throw new ComputerError("COMPUTER_JS_FAILED", {
          requestId: "RUNNER_RPC_ID_CANARY",
          nativeRequestId: "NATIVE_REQUEST_ID_CANARY",
          detail: "JS_EXCEPTION_SECRET_CANARY",
        });
      },
    }, audit, true, true);
    await expect(failing.run({ source: "FAIL_SOURCE_SECRET_CANARY", cwd })).rejects.toMatchObject({ code: "COMPUTER_JS_FAILED" });

    const log = await readFile(auditFile, "utf8");
    expect(log).toContain('"action":"computer.run_js"');
    expect(log).toContain('"outcome":"ok"');
    expect(log).toContain('"outcome":"error"');
    expect(log).toContain('"errorCode":"COMPUTER_JS_FAILED"');
    for (const forbidden of [
      source,
      cwd,
      "STDOUT_SECRET_CANARY",
      "STDERR_SECRET_CANARY",
      "RESULT_SECRET_CANARY",
      "FAIL_SOURCE_SECRET_CANARY",
      "RUNNER_RPC_ID_CANARY",
      "NATIVE_REQUEST_ID_CANARY",
      "JS_EXCEPTION_SECRET_CANARY",
    ]) {
      expect(log).not.toContain(forbidden);
    }
  });

  it("keeps actual native request ids and captured stderr out of audit across the supervisor stack", async () => {
    const { base, auditFile, audit } = await fixture();
    const config = await loadConfig({
      roots: [base],
      auditFile,
      computerUseEnabled: true,
      personalAdminEnabled: true,
    });
    const spawnCalls: Array<{ command: string; args: readonly string[]; shell: false }> = [];
    const childScript = `
      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        for (;;) {
          const newline = buffer.indexOf("\\n");
          if (newline < 0) return;
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const request = JSON.parse(line);
          process.stderr.write("NATIVE_STDERR_CANARY:" + request.requestId + "\\n");
          process.stdout.write(JSON.stringify({
            protocolVersion: 1,
            requestId: request.requestId,
            ok: false,
            error: {
              code: "COMPUTER_ACTION_FAILED",
              message: "PRIVATE_NATIVE_MESSAGE",
            },
          }) + "\\n");
        }
      });
    `;
    const spawnImpl: ComputerSpawn = (command, args, options) => {
      spawnCalls.push({ command, args, shell: options.shell });
      return spawn(process.execPath, ["-e", childScript], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    };
    const supervisor = new ComputerNativeSupervisor({
      enabled: true,
      hostBundlePath: config.computerUse.hostBundlePath,
      requestTimeoutMs: config.computerUse.requestTimeoutMs,
      spawnImpl,
    });
    const runtime = new ComputerRuntime(supervisor, config.computerUse);
    const service = new ScopedComputerService(runtime, audit, true);

    try {
      await expect(service.observe()).rejects.toMatchObject({ code: "COMPUTER_ACTION_FAILED" });
      await new Promise((resolve) => setImmediate(resolve));

      const stderr = supervisor.diagnosticStderr().content;
      expect(stderr).toContain("NATIVE_STDERR_CANARY:");
      const requestId = /NATIVE_STDERR_CANARY:([A-Za-z0-9_-]+)/.exec(stderr)?.[1];
      expect(requestId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(spawnCalls).toEqual([{
        command: path.join(
          config.computerUse.hostBundlePath,
          "Contents",
          "MacOS",
          "chatgpt-system-computer-runtime",
        ),
        args: [],
        shell: false,
      }]);

      const log = await readFile(auditFile, "utf8");
      expect(log).toContain('"errorCode":"COMPUTER_ACTION_FAILED"');
      expect(log).not.toContain("NATIVE_STDERR_CANARY");
      expect(log).not.toContain("PRIVATE_NATIVE_MESSAGE");
      expect(log).not.toContain(requestId!);
    } finally {
      await supervisor.close();
    }
  });
});

describe("Computer runtime wiring", () => {
  it("keeps one shared computer runtime in RuntimeServices and only wraps it per authority scope", async () => {
    const { base, auditFile } = await fixture();
    const projectRoot = path.join(base, "project");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(projectRoot));
    const config = await loadConfig({
      roots: [projectRoot],
      auditFile,
      computerUseEnabled: true,
      personalAdminEnabled: true,
    });
    const backend = new FakeComputerBackend();
    const runtime = createRuntimeServices(config, { computerRuntime: backend as never });
    expect(runtime.computer).toBe(backend);

    const projectLease = await runtime.authority.start({ profile: "project", projectRoots: [projectRoot] });
    const project = createScopedRuntime(runtime, runtime.authority.resolve(projectLease.leaseId));
    await expect(project.computer.observe()).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(backend.calls).toHaveLength(0);

    const adminLease = await runtime.authority.start({ profile: "admin" });
    const adminA = createScopedRuntime(runtime, runtime.authority.resolve(adminLease.leaseId));
    const adminB = createScopedRuntime(runtime, runtime.authority.resolve(adminLease.leaseId));
    await adminA.computer.observe();
    await adminB.computer.observe();
    expect(backend.calls.map((call) => call.method)).toEqual(["observe", "observe"]);
    expect(runtime.computer).toBe(backend);
  });
});
