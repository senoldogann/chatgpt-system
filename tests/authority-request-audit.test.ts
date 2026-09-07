import { describe, expect, it } from "vitest";
import {
  AuthorityRequestManager,
  type AuthorityRequestAuditEvent,
} from "../src/authority-request-manager.js";

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
});
