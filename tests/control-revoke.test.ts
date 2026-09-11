import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requestControl } from "../src/control-client.js";
import { CONTROL_PROTOCOL_VERSION } from "../src/control-protocol.js";
import { startControlServer, type ControlServerHandle } from "../src/control-server.js";
import type { AppConfig } from "../src/config.js";
import type { LocalAuthorityBroker, LocalAuthorityBrokerResult } from "../src/local-authority-broker.js";
import { createRuntimeServices } from "../src/server.js";

const cleanups: string[] = [];
const controls: ControlServerHandle[] = [];

afterEach(async () => {
  await Promise.all(controls.splice(0).map((control) => control.close()));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

class ApprovedBroker implements LocalAuthorityBroker {
  async request(input: { requestId: string; profile: "user" | "admin" }): Promise<LocalAuthorityBrokerResult> {
    return {
      requestId: input.requestId,
      profile: input.profile,
      approved: true,
      outcome: "authenticated",
    };
  }
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-revoke-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const socketPath = path.join(base, "control.sock");
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node"] },
    projectExec: { enabled: false },
    continuity: {
      databasePath: path.join(path.dirname(path.join(base, "audit.jsonl")), "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 1_000,
    },

    computerUse: {
      enabled: false,
      hostBundlePath: "/tmp/ChatGPTSystemComputerRuntime.app",
      requestTimeoutMs: 10_000,
      maxObservationElements: 500,
      maxObservationChars: 262_144,
      maxScreenshotBytes: 8_388_608,
      maxActionProgramActions: 100,
      maxActionProgramRuntimeMs: 30_000,
    },
    control: { enabled: false, socketPath },
    http: { host: "127.0.0.1", port: 4312 },
    limits: {
      maxReadBytes: 1024,
      maxWriteBytes: 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024,
      commandTimeoutMs: 1_000,
    },
  };
  const runtime = createRuntimeServices(config, { approvalBroker: new ApprovedBroker() });
  const control = await startControlServer({ socketPath, runtime });
  controls.push(control);
  return { runtime, socketPath };
}

describe("local authority delivery rollback", () => {
  it("revokes a locally delivered lease through the private control socket", async () => {
    const { runtime, socketPath } = await fixture();
    const authorized = await requestControl({
      version: CONTROL_PROTOCOL_VERSION,
      action: "authorize",
      profile: "admin",
      requestedTtlSeconds: 60,
    }, { socketPath, timeoutMs: 2_000 });
    if (!authorized.ok || !("lease" in authorized)) throw new Error("authorization failed");

    expect(runtime.authority.resolve(authorized.lease.leaseId).profile).toBe("admin");

    const revoked = await requestControl({
      version: CONTROL_PROTOCOL_VERSION,
      action: "revoke",
      authorityLeaseId: authorized.lease.leaseId,
    }, { socketPath, timeoutMs: 2_000 });

    expect(revoked).toEqual({ version: 1, ok: true, revoked: true });
    expect(() => runtime.authority.resolve(authorized.lease.leaseId)).toThrow(/authority/i);
  });
});
