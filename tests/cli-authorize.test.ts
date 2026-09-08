import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  copyLeaseToClipboard,
  parseAuthorizeArgs,
  runAuthorizeCommand,
  type ClipboardSpawn,
} from "../src/authorize-cli.js";
import type { ControlRequest, ControlResponse } from "../src/control-protocol.js";

const leaseId = "lease_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function success(profile: "user" | "admin"): ControlResponse {
  return {
    version: 1,
    ok: true,
    lease: {
      leaseId,
      profile,
      roots: profile === "user" ? ["/Users/tester"] : ["/"],
      terminalEnabled: profile === "admin",
      createdAt: "2026-09-08T00:00:00.000Z",
      expiresAt: "2026-09-08T01:00:00.000Z",
    },
  };
}

describe("local authorize CLI", () => {
  it("parses user/admin, ttl, and explicit print mode", () => {
    expect(parseAuthorizeArgs(["user"])).toEqual({ profile: "user", printLease: false });
    expect(parseAuthorizeArgs(["admin", "--ttl", "1800"])).toEqual({
      profile: "admin",
      requestedTtlSeconds: 1800,
      printLease: false,
    });
    expect(parseAuthorizeArgs(["user", "--print-lease"])).toEqual({
      profile: "user",
      printLease: true,
    });
  });

  it("rejects project, invalid ttl, server-only flags, and unknown flags", () => {
    for (const argv of [
      ["project"],
      ["user", "--ttl", "0"],
      ["user", "--ttl", "1.5"],
      ["user", "--ttl", "abc"],
      ["user", "--root", "/tmp"],
      ["admin", "--enable-terminal"],
      ["admin", "--wat"],
    ]) {
      expect(() => parseAuthorizeArgs(argv)).toThrow();
    }
  });

  it("waits long enough for native authentication, copies the lease, and does not revoke successful delivery", async () => {
    const copied: string[] = [];
    let stdout = "";
    const requestControl = vi.fn(async () => success("user"));

    await runAuthorizeCommand(
      { profile: "user", printLease: false },
      {
        socketPath: "/tmp/control.sock",
        requestControl,
        copyLease: async (value) => { copied.push(value); },
        writeStdout: (value) => { stdout += value; },
      },
    );

    expect(requestControl).toHaveBeenCalledTimes(1);
    expect(requestControl).toHaveBeenCalledWith(
      { version: 1, action: "authorize", profile: "user" },
      { socketPath: "/tmp/control.sock", timeoutMs: 130_000 },
    );
    expect(copied).toEqual([leaseId]);
    expect(stdout).toContain("User authority approved.");
    expect(stdout).toContain("Terminal: disabled");
    expect(stdout).toContain("Lease copied to clipboard.");
    expect(stdout).not.toContain(leaseId);
  });

  it("prints only the raw lease in explicit print mode and never touches clipboard or revoke", async () => {
    const copyLease = vi.fn(async () => {});
    let stdout = "";
    const requestControl = vi.fn(async () => success("admin"));

    await runAuthorizeCommand(
      { profile: "admin", requestedTtlSeconds: 1800, printLease: true },
      {
        socketPath: "/tmp/control.sock",
        requestControl,
        copyLease,
        writeStdout: (value) => { stdout += value; },
      },
    );

    expect(requestControl).toHaveBeenCalledTimes(1);
    expect(copyLease).not.toHaveBeenCalled();
    expect(stdout).toBe(`${leaseId}\n`);
  });

  it("revokes a delivered lease when clipboard delivery fails without exposing the lease", async () => {
    let stdout = "";
    const requests: ControlRequest[] = [];
    const requestControl = vi.fn(async (request: ControlRequest): Promise<ControlResponse> => {
      requests.push(request);
      if (request.action === "authorize") return success("user");
      if (request.action === "revoke") return { version: 1, ok: true, revoked: true };
      return { version: 1, ok: true, pong: true };
    });

    await expect(runAuthorizeCommand(
      { profile: "user", printLease: false },
      {
        socketPath: "/tmp/control.sock",
        requestControl,
        copyLease: async () => { throw new Error(`clipboard failed ${leaseId}`); },
        writeStdout: (value) => { stdout += value; },
      },
    )).rejects.toMatchObject({ code: "LEASE_DELIVERY_FAILED" });

    expect(requests).toEqual([
      { version: 1, action: "authorize", profile: "user" },
      { version: 1, action: "revoke", authorityLeaseId: leaseId },
    ]);
    expect(requestControl.mock.calls[1]?.[1]).toEqual({ socketPath: "/tmp/control.sock", timeoutMs: 5_000 });
    expect(stdout).not.toContain(leaseId);
  });

  it("reports unconfirmed cleanup safely when clipboard delivery and revoke both fail", async () => {
    const requestControl = vi.fn(async (request: ControlRequest): Promise<ControlResponse> => {
      if (request.action === "authorize") return success("admin");
      return {
        version: 1,
        ok: false,
        error: "AUTHORITY_REQUIRED",
        message: "An active authority lease is required.",
      };
    });

    let caught: unknown;
    try {
      await runAuthorizeCommand(
        { profile: "admin", printLease: false },
        {
          socketPath: "/tmp/control.sock",
          requestControl,
          copyLease: async () => { throw new Error(`do not leak ${leaseId}`); },
          writeStdout: () => {},
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: "LEASE_DELIVERY_FAILED" });
    expect(caught instanceof Error ? caught.message : String(caught)).toMatch(/cleanup could not be confirmed/i);
    expect(caught instanceof Error ? caught.message : String(caught)).not.toContain(leaseId);
  });

  it("surfaces stable control errors without producing clipboard output", async () => {
    const copyLease = vi.fn(async () => {});
    await expect(runAuthorizeCommand(
      { profile: "admin", printLease: false },
      {
        socketPath: "/tmp/control.sock",
        requestControl: async () => ({
          version: 1,
          ok: false,
          error: "AUTHORIZATION_BUSY",
          message: "Another local authority authorization is already in progress.",
        }),
        copyLease,
        writeStdout: () => {},
      },
    )).rejects.toMatchObject({ code: "AUTHORIZATION_BUSY" });
    expect(copyLease).not.toHaveBeenCalled();
  });

  it("feeds pbcopy over stdin with shell disabled and never places the lease in argv or env", async () => {
    const invocations: Array<{ executable: string; args: readonly string[]; options: Record<string, unknown> }> = [];
    let stdin = "";
    const spawnProcess: ClipboardSpawn = (executable, args, options) => {
      invocations.push({ executable, args, options });
      const child = new EventEmitter() as ReturnType<ClipboardSpawn>;
      const input = new PassThrough();
      input.on("data", (chunk) => { stdin += chunk.toString("utf8"); });
      Object.assign(child, { stdin: input });
      queueMicrotask(() => child.emit("close", 0));
      return child;
    };

    await copyLeaseToClipboard(leaseId, spawnProcess);

    expect(stdin).toBe(leaseId);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      executable: "/usr/bin/pbcopy",
      args: [],
      options: {
        shell: false,
        stdio: ["pipe", "ignore", "ignore"],
      },
    });
    expect(JSON.stringify(invocations[0])).not.toContain(leaseId);
  });
});
