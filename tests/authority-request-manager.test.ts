import { describe, expect, it } from "vitest";
import {
  AuthorityRequestManager,
  type AuthorityApprovalProfile,
} from "../src/authority-request-manager.js";
import {
  LocalApprovalExpiredError,
  LocalApprovalInvalidError,
} from "../src/errors.js";

describe("AuthorityRequestManager", () => {
  function fixture() {
    let now = Date.parse("2026-09-07T20:00:00.000Z");
    const manager = new AuthorityRequestManager({ now: () => now });
    return {
      manager,
      advance(ms: number) { now += ms; },
    };
  }

  it("creates opaque pending requests with a fixed two-minute approval lifetime while preserving lease ttl intent", () => {
    const { manager } = fixture();
    const request = manager.create({ profile: "user", requestedTtlSeconds: 999 });

    expect(request.requestId).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(request).toMatchObject({ profile: "user", state: "pending", requestedTtlSeconds: 999 });
    expect(Date.parse(request.expiresAt) - Date.parse(request.createdAt)).toBe(120_000);
  });

  it("keeps concurrent requests isolated and returned views immutable", () => {
    const { manager } = fixture();
    const user = manager.create({ profile: "user" });
    const admin = manager.create({ profile: "admin" });

    expect(user.requestId).not.toBe(admin.requestId);
    const userResolved = manager.resolve(user.requestId);
    const adminResolved = manager.resolve(admin.requestId);
    expect(userResolved.profile).toBe("user");
    expect(adminResolved.profile).toBe("admin");

    (userResolved as { state: string }).state = "approved";
    expect(manager.resolve(user.requestId).state).toBe("pending");
  });

  it.each([
    ["approved", true],
    ["denied", false],
    ["cancelled", false],
    ["failed", false],
  ] as const)("records terminal broker outcome %s", (state, consumable) => {
    const { manager } = fixture();
    const request = manager.create({ profile: "user" });

    const completed = manager.complete(request.requestId, state);
    expect(completed.state).toBe(state);

    if (consumable) {
      const consumed = manager.consumeApproved(request.requestId);
      expect(consumed.state).toBe("consumed");
      expect(consumed.profile).toBe("user");
      expect(() => manager.consumeApproved(request.requestId)).toThrowError(LocalApprovalInvalidError);
    } else {
      expect(() => manager.consumeApproved(request.requestId)).toThrowError(LocalApprovalInvalidError);
    }
  });

  it("expires approval requests fail closed after two minutes regardless of requested lease ttl", () => {
    const { manager, advance } = fixture();
    const request = manager.create({ profile: "admin", requestedTtlSeconds: 1 });
    advance(120_001);

    expect(() => manager.resolve(request.requestId)).toThrowError(LocalApprovalExpiredError);
    expect(() => manager.complete(request.requestId, "approved")).toThrowError(LocalApprovalInvalidError);
    expect(() => manager.consumeApproved(request.requestId)).toThrowError(LocalApprovalInvalidError);
  });

  it("rejects blank and unknown request ids", () => {
    const { manager } = fixture();
    expect(() => manager.resolve(" ")).toThrowError(LocalApprovalInvalidError);
    expect(() => manager.resolve("not-a-real-request")).toThrowError(LocalApprovalInvalidError);
  });

  it("preserves requested ttl and profile for later lease creation", () => {
    const { manager } = fixture();
    const profiles: AuthorityApprovalProfile[] = ["user", "admin"];

    for (const profile of profiles) {
      const request = manager.create({ profile, requestedTtlSeconds: 75 });
      manager.complete(request.requestId, "approved");
      const consumed = manager.consumeApproved(request.requestId);
      expect(consumed).toMatchObject({ profile, requestedTtlSeconds: 75, state: "consumed" });
    }
  });
});
