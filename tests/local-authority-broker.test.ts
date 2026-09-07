import { describe, expect, it } from "vitest";
import {
  MacOSLocalAuthorityBroker,
  type BrokerProcessInvocation,
  type BrokerProcessResult,
} from "../src/local-authority-broker.js";
import {
  LocalApprovalInvalidError,
  LocalApprovalUnavailableError,
} from "../src/errors.js";

function jsonResult(value: unknown): BrokerProcessResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
}

describe("MacOSLocalAuthorityBroker", () => {
  it("invokes one fixed helper with fixed structured arguments", async () => {
    const invocations: BrokerProcessInvocation[] = [];
    const broker = new MacOSLocalAuthorityBroker({
      helperPath: "/opt/chatgpt-system/bin/chatgpt-system-authority-broker",
      platform: "darwin",
      runProcess: async (invocation) => {
        invocations.push(invocation);
        return jsonResult({
          requestId: "request-123",
          profile: "user",
          approved: true,
          outcome: "authenticated",
        });
      },
    });

    const result = await broker.request({ requestId: "request-123", profile: "user" });

    expect(result).toEqual({
      requestId: "request-123",
      profile: "user",
      approved: true,
      outcome: "authenticated",
    });
    expect(invocations).toEqual([{
      executable: "/opt/chatgpt-system/bin/chatgpt-system-authority-broker",
      args: ["--profile", "user", "--request-id", "request-123"],
      timeoutMs: 60_000,
      maxOutputBytes: 16 * 1024,
    }]);
  });

  it("fails closed off macOS before invoking a helper", async () => {
    let called = false;
    const broker = new MacOSLocalAuthorityBroker({
      helperPath: "/tmp/helper",
      platform: "linux",
      runProcess: async () => {
        called = true;
        return jsonResult({});
      },
    });

    await expect(broker.request({ requestId: "request-123", profile: "admin" }))
      .rejects.toBeInstanceOf(LocalApprovalUnavailableError);
    expect(called).toBe(false);
  });

  it.each([
    ["request id", { requestId: "different", profile: "user", approved: true, outcome: "authenticated" }],
    ["profile", { requestId: "request-123", profile: "admin", approved: true, outcome: "authenticated" }],
    ["shape", { requestId: "request-123", profile: "user", approved: "yes", outcome: "authenticated" }],
  ])("rejects a mismatched or malformed helper %s response", async (_label, response) => {
    const broker = new MacOSLocalAuthorityBroker({
      helperPath: "/tmp/helper",
      platform: "darwin",
      runProcess: async () => jsonResult(response),
    });

    await expect(broker.request({ requestId: "request-123", profile: "user" }))
      .rejects.toBeInstanceOf(LocalApprovalInvalidError);
  });

  it("rejects non-json output without reflecting helper text", async () => {
    const broker = new MacOSLocalAuthorityBroker({
      helperPath: "/tmp/helper",
      platform: "darwin",
      runProcess: async () => ({ exitCode: 0, stdout: "secret-ish garbage", stderr: "private diagnostic" }),
    });

    await expect(broker.request({ requestId: "request-123", profile: "user" }))
      .rejects.toMatchObject({ code: "LOCAL_APPROVAL_INVALID" });
  });

  it("maps helper launch and non-zero failures to unavailable without exposing stderr", async () => {
    const spawnFailure = new MacOSLocalAuthorityBroker({
      helperPath: "/tmp/helper",
      platform: "darwin",
      runProcess: async () => { throw new Error("spawn detail with secret"); },
    });
    await expect(spawnFailure.request({ requestId: "request-123", profile: "user" }))
      .rejects.toMatchObject({ code: "LOCAL_APPROVAL_UNAVAILABLE", message: "The macOS local approval helper could not be executed." });

    const exitFailure = new MacOSLocalAuthorityBroker({
      helperPath: "/tmp/helper",
      platform: "darwin",
      runProcess: async () => ({ exitCode: 7, stdout: "", stderr: "sensitive local details" }),
    });
    await expect(exitFailure.request({ requestId: "request-123", profile: "admin" }))
      .rejects.toMatchObject({ code: "LOCAL_APPROVAL_UNAVAILABLE", message: "The macOS local approval helper did not complete successfully." });
  });

  it("passes through safe categorical denial and cancellation results", async () => {
    for (const outcome of ["denied", "cancelled", "unavailable", "failed"] as const) {
      const broker = new MacOSLocalAuthorityBroker({
        helperPath: "/tmp/helper",
        platform: "darwin",
        runProcess: async () => jsonResult({
          requestId: "request-123",
          profile: "admin",
          approved: false,
          outcome,
        }),
      });
      await expect(broker.request({ requestId: "request-123", profile: "admin" }))
        .resolves.toMatchObject({ approved: false, outcome });
    }
  });
});
