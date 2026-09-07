import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  copyLeaseToClipboard,
  parseAuthorizeArgs,
  runAuthorizeCommand,
  type ClipboardSpawn,
} from "../src/authorize-cli.js";
import type { ControlResponse } from "../src/control-protocol.js";

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

  it("copies the raw lease by default while keeping it out of stdout", async () => {
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

    expect(requestControl).toHaveBeenCalledWith(
      { version: 1, action: "authorize", profile: "user" },
      { socketPath: "/tmp/control.sock" },
    );
    expect(copied).toEqual([leaseId]);
    expect(stdout).toContain("User authority approved.");
    expect(stdout).toContain("Terminal: disabled");
    expect(stdout).toContain("Lease copied to clipboard.");
    expect(stdout).not.toContain(leaseId);
  });

  it("prints only the raw lease in explicit print mode and never touches clipboard", async () => {
    const copyLease = vi.fn(async () => {});
    let stdout = "";

    await runAuthorizeCommand(
      { profile: "admin", requestedTtlSeconds: 1800, printLease: true },
      {
        socketPath: "/tmp/control.sock",
        requestControl: async () => success("admin"),
        copyLease,
        writeStdout: (value) => { stdout += value; },
      },
    );

    expect(copyLease).not.toHaveBeenCalled();
    expect(stdout).toBe(`${leaseId}\n`);
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
