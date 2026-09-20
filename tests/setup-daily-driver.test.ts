import { stat } from "node:fs/promises";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_AGENT_LABEL,
  RESTART_HELPER_LABEL,
  activateLaunchAgent,
  buildLaunchAgent,
  buildLaunchctlCommands,
  buildRestartSubmitInvocation,
  keychainDeleteInvocation,
  keychainReadInvocation,
  keychainStoreInvocation,
  keychainTypesafeDeleteInvocation,
  keychainTypesafeReadInvocation,
  keychainTypesafeStoreInvocation,
  installKeychainHelper,
  planControlPlaneCredential,
  planTypesafeCredential,
  runRestartHelper,
  storeControlPlaneKey,
  storeTypesafeApiKey,
} from "../scripts/setup-daily-driver.mjs";

describe("macOS daily-driver setup", () => {
  it("builds a user LaunchAgent without embedding the control-plane key", () => {
    const sentinel = "sentinel-control-plane-secret";
    const plist = buildLaunchAgent({
      nodePath: "/opt/homebrew/bin/node",
      runnerPath: "/Users/test/chatgpt-system/scripts/daily-driver-runner.mjs",
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "work-profile",
      logDir: "/Users/test/.chatgpt-system/daily-driver",
      keychainHelperPath: "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
    });

    expect(plist).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain("<string>--profile</string>");
    expect(plist).toContain("<string>work-profile</string>");
    expect(plist).toContain("<string>--keychain-helper</string>");
    expect(plist).toContain("<string>/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper</string>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(plist).not.toContain("CONTROL_PLANE_API_KEY");
    expect(plist).not.toContain("TYPESAFE_API_KEY");
    expect(plist).not.toContain(sentinel);
  });

  it("reuses an existing Keychain credential through the dedicated helper", () => {
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    const action = planControlPlaneCredential(undefined, {
      helperPath,
      spawnSync: () => ({ status: 0, stdout: "existing-key", stderr: "" }),
    });

    expect(action).toBe("reuse");
  });

  it("still requires CONTROL_PLANE_API_KEY when no Keychain credential exists", () => {
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    expect(() => planControlPlaneCredential(undefined, {
      helperPath,
      spawnSync: () => ({ status: 44, stdout: "", stderr: "not found" }),
    })).toThrow(/CONTROL_PLANE_API_KEY/i);
  });

  it("plans TypeSafe credential: stores when provided, reuses when present, skips when absent", () => {
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    expect(planTypesafeCredential("explicit-key", { helperPath })).toBe("store");

    const reuseAction = planTypesafeCredential(undefined, {
      helperPath,
      spawnSync: () => ({ status: 0, stdout: "existing-key", stderr: "" }),
    });
    expect(reuseAction).toBe("reuse");

    const skipAction = planTypesafeCredential(undefined, {
      helperPath,
      spawnSync: () => ({ status: 44, stdout: "", stderr: "not found" }),
    });
    expect(skipAction).toBe("skip");
  });

  it("rejects non-absolute executable and runner paths", () => {
    expect(() => buildLaunchAgent({
      nodePath: "node",
      runnerPath: "/Users/test/chatgpt-system/scripts/daily-driver-runner.mjs",
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "work-profile",
      logDir: "/Users/test/.chatgpt-system/daily-driver",
      keychainHelperPath: "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
    })).toThrow(/Node path must be an absolute path/i);

    expect(() => buildLaunchAgent({
      nodePath: "/opt/homebrew/bin/node",
      runnerPath: "scripts/daily-driver-runner.mjs",
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "work-profile",
      logDir: "/Users/test/.chatgpt-system/daily-driver",
      keychainHelperPath: "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
    })).toThrow(/Runner path must be an absolute path/i);
  });

  it("stores the key through the native Keychain helper without transforming or exposing the secret", () => {
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const helperPath = "/Users/test/chatgpt-system/native/macos-authority-broker/.build/release/chatgpt-system-keychain-helper";

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

  it("stores and invokes TypeSafe Keychain helper commands without exposing the secret in argv", () => {
    const helperPath = "/Users/test/chatgpt-system/native/macos-authority-broker/.build/release/chatgpt-system-keychain-helper";
    expect(keychainTypesafeStoreInvocation(helperPath)).toEqual({
      command: helperPath,
      args: ["store", "chatgpt-system", "chatgpt-system-typesafe"],
    });
    expect(keychainTypesafeReadInvocation(helperPath)).toEqual({
      command: helperPath,
      args: ["read", "chatgpt-system", "chatgpt-system-typesafe"],
    });
    expect(keychainTypesafeDeleteInvocation(helperPath)).toEqual({
      command: helperPath,
      args: ["delete", "chatgpt-system", "chatgpt-system-typesafe"],
    });

    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    storeTypesafeApiKey("typesafe-secret", {
      helperPath,
      spawnSync: (command: string, args: string[], options: Record<string, unknown>) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(helperPath);
    expect(JSON.stringify(calls[0]?.args)).not.toContain("typesafe-secret");
    expect(calls[0]?.options).toMatchObject({ input: "typesafe-secret" });
  });

  it("installs the built Keychain helper at a private executable path", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-keychain-install-"));
    try {
      const source = path.join(base, "build", "chatgpt-system-keychain-helper");
      const destination = path.join(base, ".chatgpt-system", "bin", "chatgpt-system-keychain-helper");
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, "fixture-helper", { encoding: "utf8", mode: 0o755 });

      await installKeychainHelper(source, destination);

      expect((await readFile(destination, "utf8"))).toBe("fixture-helper");
      expect((await stat(destination)).mode & 0o777).toBe(0o700);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("constructs dedicated read and idempotent delete helper invocations", () => {
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    expect(keychainReadInvocation(helperPath)).toEqual({
      command: helperPath,
      args: ["read", "chatgpt-system", "chatgpt-system-control-plane"],
    });
    expect(keychainDeleteInvocation(helperPath)).toEqual({
      command: helperPath,
      args: ["delete", "chatgpt-system", "chatgpt-system-control-plane"],
    });
  });

  it("builds correct launchctl commands for the current user gui domain", () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    const commands = buildLaunchctlCommands({ uid: 501, plistPath });

    expect(commands).toEqual({
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

    const activation = activateLaunchAgent({
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

    expect(activation).toBe("restart-scheduled");
    expect(calls).toEqual([
      { command: "/bin/launchctl", args: ["print", `gui/501/${LAUNCH_AGENT_LABEL}`] },
      { command: "/bin/launchctl", args: ["remove", RESTART_HELPER_LABEL] },
      {
        command: "/bin/launchctl",
        args: [
          "submit",
          "-l", RESTART_HELPER_LABEL,
          "--",
          "/opt/homebrew/bin/node",
          "/Users/test/chatgpt-system/scripts/setup-daily-driver.mjs",
          "restart-helper",
          "--uid", "501",
          "--plist", plistPath,
        ],
      },
    ]);
  });

  it("reloads the target from the independent helper and then removes the submitted helper job", async () => {
    const plistPath = "/Users/test/Library/LaunchAgents/com.senoldogann.chatgpt-system.daily-driver.plist";
    const calls: Array<{ command: string; args: string[] }> = [];

    await runRestartHelper({ uid: 501, plistPath }, {
      wait: async () => {},
      runCommand: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    });

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
        if (args[0] === "bootstrap") return { status: 1, stdout: "", stderr: "bootstrap failed" };
        return { status: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow("bootstrap failed");

    expect(calls).toEqual([
      { command: "/bin/launchctl", args: ["bootout", "gui/501", plistPath] },
      { command: "/bin/launchctl", args: ["bootstrap", "gui/501", plistPath] },
      { command: "/bin/launchctl", args: ["remove", RESTART_HELPER_LABEL] },
    ]);
  });
});
