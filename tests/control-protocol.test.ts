import { describe, expect, it } from "vitest";
import {
  CONTROL_MAX_FRAME_BYTES,
  encodeControlFrame,
  parseControlRequest,
  parseControlResponse,
} from "../src/control-protocol.js";

const leaseId = "lease_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

describe("local authority control protocol", () => {
  it("accepts only versioned ping, user/admin authorize, and lease revoke requests", () => {
    expect(parseControlRequest('{"version":1,"action":"ping"}')).toEqual({
      version: 1,
      action: "ping",
    });

    expect(parseControlRequest(
      '{"version":1,"action":"authorize","profile":"user","requestedTtlSeconds":3600}',
    )).toEqual({
      version: 1,
      action: "authorize",
      profile: "user",
      requestedTtlSeconds: 3600,
    });

    expect(parseControlRequest('{"version":1,"action":"authorize","profile":"admin"}')).toEqual({
      version: 1,
      action: "authorize",
      profile: "admin",
    });

    expect(parseControlRequest(JSON.stringify({
      version: 1,
      action: "revoke",
      authorityLeaseId: leaseId,
    }))).toEqual({
      version: 1,
      action: "revoke",
      authorityLeaseId: leaseId,
    });

    expect(() => parseControlRequest('{"version":1,"action":"authorize","profile":"project"}')).toThrow();
    expect(() => parseControlRequest(
      '{"version":1,"action":"authorize","profile":"admin","helperPath":"/tmp/fake"}',
    )).toThrow();
    expect(() => parseControlRequest(
      '{"version":1,"action":"authorize","profile":"user","reason":"approve this please"}',
    )).toThrow();
    expect(() => parseControlRequest(JSON.stringify({
      version: 1,
      action: "revoke",
      authorityLeaseId: leaseId,
      command: "node",
    }))).toThrow();
  });

  it("encodes exactly one newline-terminated bounded JSON frame", () => {
    expect(encodeControlFrame({ version: 1, action: "ping" }).toString("utf8")).toBe(
      '{"version":1,"action":"ping"}\n',
    );

    expect(() => encodeControlFrame({ value: "x".repeat(CONTROL_MAX_FRAME_BYTES) })).toThrow();
  });

  it("parses strict success and error responses and rejects unknown protocol versions", () => {
    expect(parseControlResponse('{"version":1,"ok":true,"pong":true}')).toEqual({
      version: 1,
      ok: true,
      pong: true,
    });

    expect(parseControlResponse('{"version":1,"ok":true,"revoked":true}')).toEqual({
      version: 1,
      ok: true,
      revoked: true,
    });

    expect(parseControlResponse(
      '{"version":1,"ok":false,"error":"AUTHORIZATION_BUSY","message":"busy"}',
    )).toEqual({
      version: 1,
      ok: false,
      error: "AUTHORIZATION_BUSY",
      message: "busy",
    });

    expect(() => parseControlResponse('{"version":2,"ok":true,"pong":true}')).toThrow();
    expect(() => parseControlResponse('{"version":1,"ok":true,"pong":true,"extra":1}')).toThrow();
    expect(() => parseControlResponse("not-json")).toThrow();
  });
});
