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
import {
  MACOS_AUTHORITY_HELPER_PATH,
  type NativeHelperTrustValidator,
} from "../src/native-helper-trust.js";

function jsonResult(value: unknown): BrokerProcessResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
}

function trusted(order?: string[]): NativeHelperTrustValidator {
  return {
    async validate() {
      order?.push("trust");
    },
  };
}

describe("MacOSLocalAuthorityBroker", () => {
  it("validates trust before invoking the fixed protected helper", async () => {
    const order: string[] = [];
    const invocations: BrokerProcessInvocation[] = [];
    const broker = new MacOSLocalAuthorityBroker({
      platform: "darwin",
      trustValidator: trusted(order),
      runProcess: async (invocation) => {
        order.push("spawn");
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
    expect(order).toEqual(["trust", "spawn"]);
    expect(invocations).toEqual([{
      executable: MACOS_AUTHORITY_HELPER_PATH,
      args: ["--profile", "user", "--request-id", "request-123"],
      timeoutMs: 60_000,
      maxOutputBytes: 16 * 1024,
    }]);
  });

  it("fails closed when protected helper trust validation fails and never spawns", async () => {
    let called = false;
    const broker = new MacOSLocalAuthorityBroker({
      platform: "darwin",
      trustValidator: { async validate() { throw new Error("private trust detail"); } },
      runProcess: async () => {
        called = true;
        return jsonResult({});
      },
    });

    await expect(broker.request({ requestId: "request-123", profile: "user" }))
      .rejects.toMatchObject({
        code: "LOCAL_APPROVAL_UNAVAILABLE",
        message: "The protected macOS local approval helper is unavailable or untrusted.",
      });
    expect(called).toBe(false);
  });

  it("fails closed off macOS before validating trust or invoking a helper", async () => {
    let trustCalled = false;
    let processCalled = false;
    const broker = new MacOSLocalAuthorityBroker({
      platform: "linux",
      trustValidator: { async validate() { trustCalled = true; } },
      runProcess: async () => {
        processCalled = true;
        return jsonResult({});
      },
    });

    await expect(broker.request({ requestId: "request-123", profile: "admin" }))
      .rejects.toBeInstanceOf(LocalApprovalUnavailableError);
    expect(trustCalled).toBe(false);
    expect(processCalled).toBe(false);
  });

  it.each([
    ["request id", { requestId: "different", profile: "user", approved: true, outcome: "authenticated" }],
    ["profile", { requestId: "request-123", profile: "admin", approved: true, outcome: "authenticated" }],
    ["shape", { requestId: "request-123", profile: "user", approved: "yes", outcome: "authenticated" }],
  ])("rejects a mismatched or malformed helper %s response", async (_label, response) => {
    const broker = new MacOSLocalAuthorityBroker({
      platform: "darwin",
      trustValidator: trusted(),
      runProcess: async () => jsonResult(response),
    });

    await expect(broker.request({ requestId: "request-123", profile: "user" }))
      .rejects.toBeInstanceOf(LocalApprovalInvalidError);
  });

  it("rejects non-json output without reflecting helper text", async () => {
    const broker = new MacOSLocalAuthorityBroker({
      platform: "darwin",
      trustValidator: trusted(),
      runProcess: async () => ({ exitCode: 0, stdout: "secret-ish garbage", stderr: "private diagnostic" }),
    });

    await expect(broker.request({ requestId: "request-123", profile: "user" }))
      .rejects.toMatchObject({ code: "LOCAL_APPROVAL_INVALID" });
  });

  it("maps helper launch and non-zero failures to unavailable without exposing stderr", async () => {
    const spawnFailure = new MacOSLocalAuthorityBroker({
      platform: "darwin",
      trustValidator: trusted(),
      runProcess: async () => { throw new Error("spawn detail with secret"); },
    });
    await expect(spawnFailure.request({ requestId: "request-123", profile: "user" }))
      .rejects.toMatchObject({ code: "LOCAL_APPROVAL_UNAVAILABLE", message: "The macOS local approval helper could not be executed." });

    const exitFailure = new MacOSLocalAuthorityBroker({
      platform: "darwin",
      trustValidator: trusted(),
      runProcess: async () => ({ exitCode: 7, stdout: "", stderr: "sensitive local details" }),
    });
    await expect(exitFailure.request({ requestId: "request-123", profile: "admin" }))
      .rejects.toMatchObject({ code: "LOCAL_APPROVAL_UNAVAILABLE", message: "The macOS local approval helper did not complete successfully." });
  });

  it("passes through safe categorical denial and cancellation results", async () => {
    for (const outcome of ["denied", "cancelled", "unavailable", "failed"] as const) {
      const broker = new MacOSLocalAuthorityBroker({
        platform: "darwin",
        trustValidator: trusted(),
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
