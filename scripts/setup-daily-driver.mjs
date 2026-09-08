#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from "./daily-driver-runner.mjs";

export const LAUNCH_AGENT_LABEL = "com.senoldogann.chatgpt-system.daily-driver";
const LAUNCHCTL = "/bin/launchctl";
const SECURITY = "/usr/bin/security";
const SWIFT = "/usr/bin/swift";
const LAUNCH_AGENT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requireAbsolute(value, label) {
  if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  return path.normalize(value);
}

function validateProfile(profile) {
  if (!profile || !/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw new Error("Profile may contain only letters, numbers, '-' and '_'.");
  }
  return profile;
}

export function buildLaunchAgent(options) {
  const nodePath = requireAbsolute(options.nodePath, "Node path");
  const runnerPath = requireAbsolute(options.runnerPath, "Runner path");
  const tunnelClientPath = requireAbsolute(options.tunnelClientPath, "tunnel-client path");
  const logDir = requireAbsolute(options.logDir, "Log directory");
  const profile = validateProfile(options.profile);
  const args = [
    nodePath,
    runnerPath,
    "--tunnel-client", tunnelClientPath,
    "--profile", profile,
    "--log-dir", logDir,
  ];

  const argumentXml = args.map((value) => `      <string>${xmlEscape(value)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argumentXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${LAUNCH_AGENT_PATH}</string>
    </dict>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
  </dict>
</plist>
`;
}

export function keychainHelperBuildInvocation(repoDir) {
  const normalizedRepo = requireAbsolute(repoDir, "Repository path");
  const packagePath = path.join(normalizedRepo, "native", "macos-authority-broker");
  const helperPath = path.join(packagePath, ".build", "release", "chatgpt-system-keychain-helper");
  return {
    command: SWIFT,
    args: ["build", "-c", "release", "--package-path", packagePath, "--product", "chatgpt-system-keychain-helper"],
    helperPath,
  };
}

export function keychainStoreInvocation(helperPath) {
  const command = requireAbsolute(helperPath, "Keychain helper path");
  return { command, args: ["store", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE] };
}

export function storeControlPlaneKey(key, options = {}) {
  if (!key) throw new Error("CONTROL_PLANE_API_KEY is required for daily-driver installation.");
  const spawnSyncImpl = options.spawnSync ?? spawnSync;
  const invocation = keychainStoreInvocation(options.helperPath);
  const result = spawnSyncImpl(invocation.command, invocation.args, {
    shell: false,
    encoding: "utf8",
    input: key,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error("Unable to store the daily-driver tunnel credential in macOS Keychain.");
  }
}

export function planControlPlaneCredential(key, options = {}) {
  if (key) return "store";
  const spawnSyncImpl = options.spawnSync ?? spawnSync;
  const result = spawnSyncImpl(SECURITY, [
    "find-generic-password",
    "-a", KEYCHAIN_ACCOUNT,
    "-s", KEYCHAIN_SERVICE,
  ], {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!result.error && result.status === 0) return "reuse";
  throw new Error("CONTROL_PLANE_API_KEY must be set when no daily-driver Keychain credential exists.");
}

export function buildLaunchctlCommands({ uid, plistPath }) {
  if (!Number.isInteger(uid) || uid < 0) throw new Error("A valid user uid is required.");
  const normalizedPlist = requireAbsolute(plistPath, "LaunchAgent plist path");
  const domain = `gui/${uid}`;
  return {
    bootout: ["bootout", domain, normalizedPlist],
    bootstrap: ["bootstrap", domain, normalizedPlist],
    status: ["print", `${domain}/${LAUNCH_AGENT_LABEL}`],
  };
}

function parseArgs(argv) {
  const command = argv[0] ?? "install";
  if (!["install", "status", "uninstall"].includes(command)) {
    throw new Error("Usage: setup-daily-driver.mjs <install|status|uninstall> [--profile name]");
  }
  let profile = "chatgpt-system";
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--profile") throw new Error(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--profile requires a value.");
    profile = value;
    index += 1;
  }
  return { command, profile: validateProfile(profile) };
}

async function resolveExecutable(name, environment) {
  const pathValue = environment.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      await access(candidate, fsConstants.X_OK);
      return realpath(candidate);
    } catch {
      // Keep scanning PATH entries.
    }
  }
  throw new Error(`${name} was not found as an executable on PATH.`);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    shell: false,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return result;
}

function assertSuccess(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
}

async function writePlistAtomic(plistPath, content) {
  await mkdir(path.dirname(plistPath), { recursive: true, mode: 0o700 });
  const temporary = `${plistPath}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, plistPath);
}

function pathsFor(homeDir) {
  const launchAgentsDir = path.join(homeDir, "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${LAUNCH_AGENT_LABEL}.plist`);
  const logDir = path.join(homeDir, ".chatgpt-system", "daily-driver");
  return { launchAgentsDir, plistPath, logDir };
}

async function install(profile, context) {
  if (process.platform !== "darwin") throw new Error("Daily-driver LaunchAgent installation is supported only on macOS.");
  const key = context.environment.CONTROL_PLANE_API_KEY;
  const credentialAction = planControlPlaneCredential(key);

  const tunnelClientPath = await resolveExecutable("tunnel-client", context.environment);
  const runnerPath = path.join(context.repoDir, "scripts", "daily-driver-runner.mjs");
  await access(runnerPath, fsConstants.R_OK);
  const { plistPath, logDir } = pathsFor(context.homeDir);
  const plist = buildLaunchAgent({
    nodePath: process.execPath,
    runnerPath,
    tunnelClientPath,
    profile,
    logDir,
  });
  const commands = buildLaunchctlCommands({ uid: context.uid, plistPath });
  const keychainHelper = keychainHelperBuildInvocation(context.repoDir);

  await mkdir(logDir, { recursive: true, mode: 0o700 });
  if (credentialAction === "store") {
    assertSuccess(runCommand(keychainHelper.command, keychainHelper.args), "Keychain helper build");
    storeControlPlaneKey(key, { helperPath: keychainHelper.helperPath });
  }
  await writePlistAtomic(plistPath, plist);
  runCommand(LAUNCHCTL, commands.bootout);
  assertSuccess(runCommand(LAUNCHCTL, commands.bootstrap), "launchctl bootstrap");

  console.log(`Daily driver installed: ${LAUNCH_AGENT_LABEL}`);
  console.log(
    credentialAction === "store"
      ? "Tunnel credential stored in macOS Keychain; no API key was written to the LaunchAgent plist."
      : "Existing macOS Keychain tunnel credential reused; no API key was written to the LaunchAgent plist.",
  );
}

async function status(profile, context) {
  void profile;
  const { plistPath } = pathsFor(context.homeDir);
  const commands = buildLaunchctlCommands({ uid: context.uid, plistPath });
  const result = runCommand(LAUNCHCTL, commands.status, { inherit: true });
  if (result.error || result.status !== 0) {
    throw new Error("Daily-driver LaunchAgent is not loaded.");
  }
}

async function uninstall(profile, context) {
  void profile;
  const { plistPath } = pathsFor(context.homeDir);
  const commands = buildLaunchctlCommands({ uid: context.uid, plistPath });
  runCommand(LAUNCHCTL, commands.bootout);
  try {
    await unlink(plistPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  runCommand(SECURITY, ["delete-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE]);
  console.log(`Daily driver uninstalled: ${LAUNCH_AGENT_LABEL}`);
}

const scriptPath = fileURLToPath(import.meta.url);
const repoDir = path.resolve(path.dirname(scriptPath), "..");

async function main() {
  const { command, profile } = parseArgs(process.argv.slice(2));
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Unable to determine current user uid.");
  const context = {
    environment: process.env,
    homeDir: homedir(),
    repoDir,
    uid,
  };
  if (command === "install") return install(profile, context);
  if (command === "status") return status(profile, context);
  return uninstall(profile, context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[chatgpt-system] daily-driver setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
