import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthorityRequestManager,
  type AuthorityRequestAuditEvent,
} from "../src/authority-request-manager.js";
import type { AppConfig } from "../src/config.js";
import { createRuntimeServices } from "../src/server.js";

describe("local authority request audit", () => {
  it("records categorical lifecycle metadata without raw request ids", async () => {
    const events: AuthorityRequestAuditEvent[] = [];
    const manager = new AuthorityRequestManager({
      audit: async (event) => { events.push(event); },
    });

    const request = manager.create({ profile: "user", requestedTtlSeconds: 3600 });
    manager.complete(request.requestId, "approved");
    manager.consumeApproved(request.requestId);
    await manager.flushAudit();

    expect(events.map((event) => event.event)).toEqual([
      "authority.request.created",
      "authority.request.completed",
      "authority.request.consumed",
    ]);
    expect(events.map((event) => event.state)).toEqual(["pending", "approved", "consumed"]);
    for (const event of events) {
      expect(event.profile).toBe("user");
      expect(JSON.stringify(event)).not.toContain(request.requestId);
    }
  });

  it("records expiry categorically and does not revive the request", async () => {
    const events: AuthorityRequestAuditEvent[] = [];
    let now = Date.parse("2026-09-07T20:00:00.000Z");
    const manager = new AuthorityRequestManager({
      now: () => now,
      audit: async (event) => { events.push(event); },
    });
    const request = manager.create({ profile: "admin" });
    now += 120_001;
    expect(() => manager.resolve(request.requestId)).toThrow();
    await manager.flushAudit();

    expect(events.at(-1)).toMatchObject({
      event: "authority.request.expired",
      profile: "admin",
      state: "expired",
    });
    expect(JSON.stringify(events)).not.toContain(request.requestId);
  });

  it("persists redacted request lifecycle through the runtime audit logger", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-request-audit-runtime-"));
    try {
      const root = path.join(base, "root");
      await mkdir(root);
      const auditFile = path.join(base, "audit.jsonl");
      const config: AppConfig = {
        roots: [root],
        auditFile,
        terminal: { enabled: false, commands: ["node"] },
        projectExec: { enabled: false },
        continuity: {
          databasePath: path.join(path.dirname(auditFile), "continuity.db"),
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
        http: { host: "127.0.0.1", port: 4312 },
        limits: {
          maxReadBytes: 1024,
          maxWriteBytes: 1024,
          maxDirectoryEntries: 100,
          maxCommandOutputBytes: 1024,
          commandTimeoutMs: 1_000,
        },
      };

      const runtime = createRuntimeServices(config);
      const request = runtime.authorityRequests.create({ profile: "user", requestedTtlSeconds: 3600 });
      runtime.authorityRequests.complete(request.requestId, "denied");
      await runtime.authorityRequests.flushAudit();

      const audit = await readFile(auditFile, "utf8");
      expect(audit).toContain('"action":"authority.request.created"');
      expect(audit).toContain('"action":"authority.request.completed"');
      expect(audit).toContain('"profile":"user"');
      expect(audit).toContain('"state":"denied"');
      expect(audit).not.toContain(request.requestId);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
