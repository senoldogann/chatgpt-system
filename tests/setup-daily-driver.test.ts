import { describe, expect, it } from "vitest";
import {
  LAUNCH_AGENT_LABEL,
  buildLaunchAgent,
  buildLaunchctlCommands,
  keychainStoreInvocation,
  storeControlPlaneKey,
} from "../scripts/setup-daily-driver.mjs";

describe("macOS daily-driver setup", () => {
  it("builds a user LaunchAgent without embedding the control-plane key", () => {
    const sentinel = "sentinel-secret";
    const plist = buildLaunchAgent({
      nodePath: "/opt/homebrew/bin/node",
      runnerPath: "/Users/test/chatgpt-system/scripts/daily-driver-runner.mjs",
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "chatgpt-system",
      logDir: "/Users/test/.chatgpt-system/daily-driver",
    });

    expect(plist).toContain(LAUNCH_AGENT_LABEL);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>ProcessType</key>");
    expect(plist).toContain("<string>Background</string>");
    expect(plist).toContain("/opt/homebrew/bin/node");
    expect(plist).toContain("/opt/homebrew/bin/tunnel-client");
    expect(plist).not.toContain("CONTROL_PLANE_API_KEY");
    expect(plist).not.toContain(sentinel);
  });

  it("rejects non-absolute executable and runner paths", () => {
    expect(() => buildLaunchAgent({
      nodePath: "node",
      runnerPath: "/Users/test/runner.mjs",
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "chatgpt-system",
      logDir: "/tmp/logs",
    })).toThrow(/absolute/i);

    expect(() => buildLaunchAgent({
      nodePath: "/opt/homebrew/bin/node",
      runnerPath: "/Users/test/runner.mjs",
      tunnelClientPath: "tunnel-client",
      profile: "chatgpt-system",
      logDir: "/tmp/logs",
    })).toThrow(/absolute/i);
  });

  it("stores the key through a silent TTY responder without putting the secret in argv", () => {
    const invocation = keychainStoreInvocation();
    expect(invocation.command).toBe("/usr/bin/expect");
    expect(invocation.args[0]).toBe("-c");
    expect(invocation.args.join(" ")).toContain("/usr/bin/security add-generic-password");
    expect(invocation.args.join(" ")).toContain("log_user 0");
    expect(invocation.args.join(" ")).toContain("retype password for new item");
    expect(invocation.args.join(" ")).not.toContain("sentinel-secret");

    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    storeControlPlaneKey("sentinel-secret", {
      spawnSync: (command: string, args: string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/usr/bin/expect");
    expect(JSON.stringify(calls[0]?.args)).not.toContain("sentinel-secret");
    expect(calls[0]?.options).toMatchObject({ input: "sentinel-secret\n" });
  });

  it("constructs deterministic user-scoped launchctl commands", () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    expect(buildLaunchctlCommands({ uid: 501, plistPath })).toEqual({
      bootout: ["bootout", "gui/501", plistPath],
      bootstrap: ["bootstrap", "gui/501", plistPath],
      status: ["print", `gui/501/${LAUNCH_AGENT_LABEL}`],
    });
  });
});
