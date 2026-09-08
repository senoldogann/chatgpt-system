import { describe, expect, it } from "vitest";
import {
  LAUNCH_AGENT_LABEL,
  RESTART_HELPER_LABEL,
  activateLaunchAgent,
  buildLaunchAgent,
  buildLaunchctlCommands,
  buildRestartSubmitInvocation,
  keychainStoreInvocation,
  planControlPlaneCredential,
  runRestartHelper,
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
    expect(plist).toContain("<key>EnvironmentVariables</key>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(plist).not.toContain("CONTROL_PLANE_API_KEY");
    expect(plist).not.toContain(sentinel);
  });

  it("reuses an existing Keychain credential when reinstalling without CONTROL_PLANE_API_KEY", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const action = planControlPlaneCredential(undefined, {
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(action).toBe("reuse");
    expect(calls).toEqual([{
      command: "/usr/bin/security",
      args: ["find-generic-password", "-a", "chatgpt-system", "-s", "chatgpt-system-control-plane"],
    }]);
  });

  it("still requires CONTROL_PLANE_API_KEY when no Keychain credential exists", () => {
    expect(() => planControlPlaneCredential(undefined, {
      spawnSync: () => ({ status: 44, stdout: "", stderr: "not found" }),
    })).toThrow(/CONTROL_PLANE_API_KEY/i);
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

  it("stores the key through the native Keychain helper without transforming or exposing the secret", () => {
    const helperPath = "/Users/test/chatgpt-system/native/macos-authority-broker/.build/release/chatgpt-system-keychain-helper";
    const invocation = keychainStoreInvocation(helperPath);
    expect(invocation.command).toBe(helperPath);
    expect(invocation.args).toEqual(["store", "chatgpt-system", "chatgpt-system-control-plane"]);
    expect(invocation.args.join(" ")).not.toContain("sentinel-secret");

    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    storeControlPlaneKey("sentinel-secret", {
      helperPath,
      spawnSync: (command: string, args: string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(helperPath);
    expect(JSON.stringify(calls[0]?.args)).not.toContain("sentinel-secret");
    expect(calls[0]?.options).toMatchObject({ input: "sentinel-secret" });
  });

  it("constructs deterministic user-scoped launchctl commands", () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    expect(buildLaunchctlCommands({ uid: 501, plistPath })).toEqual({
      bootout: ["bootout", "gui/501", plistPath],
      bootstrap: ["bootstrap", "gui/501", plistPath],
      status: ["print", `gui/501/${LAUNCH_AGENT_LABEL}`],
    });
  });

  it("delegates an in-place reload to a launchd-owned helper before stopping the daily-driver job", () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    const setupScriptPath = "/Users/test/chatgpt-system/scripts/setup-daily-driver.mjs";
    const invocation = buildRestartSubmitInvocation({
      uid: 501,
      plistPath,
      nodePath: "/opt/homebrew/bin/node",
      setupScriptPath,
    });

    expect(invocation).toEqual({
      command: "/bin/launchctl",
      args: [
        "submit",
        "-l", RESTART_HELPER_LABEL,
        "--",
        "/opt/homebrew/bin/node",
        setupScriptPath,
        "restart-helper",
        "--uid", "501",
        "--plist", plistPath,
      ],
    });
    expect(invocation.args.slice(0, 4)).not.toContain("bootout");
  });

  it("schedules the helper instead of booting out a loaded daily-driver from its own process tree", () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = activateLaunchAgent({
      uid: 501,
      plistPath,
      nodePath: "/opt/homebrew/bin/node",
      setupScriptPath: "/Users/test/chatgpt-system/scripts/setup-daily-driver.mjs",
    }, {
      runCommand: (command: string, args: string[]) => {
        calls.push({ command, args });
        if (args[0] === "print") return { status: 0, stdout: "loaded", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toBe("restart-scheduled");
    expect(calls[0]).toEqual({
      command: "/bin/launchctl",
      args: ["print", `gui/501/${LAUNCH_AGENT_LABEL}`],
    });
    expect(calls.some(({ args }) => args[0] === "submit" && args.includes(RESTART_HELPER_LABEL))).toBe(true);
    expect(calls.some(({ args }) => (
      (args[0] === "bootout" || args[0] === "bootstrap") && args.includes(plistPath)
    ))).toBe(false);
  });

  it("reloads the target from the independent helper and then removes the submitted helper job", async () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    const calls: Array<{ command: string; args: string[] }> = [];
    const waits: number[] = [];

    await runRestartHelper({ uid: 501, plistPath }, {
      wait: async (milliseconds: number) => { waits.push(milliseconds); },
      runCommand: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(0);
    expect(calls).toEqual([
      { command: "/bin/launchctl", args: ["bootout", "gui/501", plistPath] },
      { command: "/bin/launchctl", args: ["bootstrap", "gui/501", plistPath] },
      { command: "/bin/launchctl", args: ["remove", RESTART_HELPER_LABEL] },
    ]);
  });

  it("removes the submitted helper job even when target bootstrap fails", async () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    const calls: Array<{ command: string; args: string[] }> = [];

    await expect(runRestartHelper({ uid: 501, plistPath }, {
      wait: async () => {},
      runCommand: (command: string, args: string[]) => {
        calls.push({ command, args });
        if (args[0] === "bootstrap") {
          return { status: 5, stdout: "", stderr: "bootstrap failed" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow(/launchctl bootstrap failed/i);

    expect(calls.at(-1)).toEqual({
      command: "/bin/launchctl",
      args: ["remove", RESTART_HELPER_LABEL],
    });
  });
});
