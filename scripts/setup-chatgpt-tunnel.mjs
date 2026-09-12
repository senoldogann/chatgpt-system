#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectInstalledComputerRuntime } from "./setup-macos-computer-runtime.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");
const protectedBrokerHelperPath = "/Library/Application Support/chatgpt-system/bin/chatgpt-system-authority-broker";
const protectedBrokerMetadataPath = "/Library/Application Support/chatgpt-system/etc/authority-broker.sha256";

function usage() {
  console.log(`Usage:
  npm run setup:chatgpt -- --root /absolute/path/to/project --tunnel-id tunnel_... [options]

Options:
  --root <path>           Explicit bootstrap filesystem root. Required.
  --tunnel-id <id>        OpenAI Secure MCP Tunnel ID. Required.
  --profile <name>        tunnel-client profile name (default: chatgpt-system).
  --enable-terminal       Opt in to bootstrap terminal configuration. Disabled by default.
  --enable-project-exec   Opt in to Docker-sandboxed Project execution. Disabled by default.
  --personal-admin        Allow ChatGPT to mint short-lived Admin leases directly. Disabled by default.
  --enable-owner-runtime  Opt in to Admin-only unrestricted Owner Runtime shell execution; requires --personal-admin.
  --owner-shell-path <path>
                          Override the trusted login shell executable; requires --enable-owner-runtime.
  --allow-command <name>  Allowlisted executable basename. Repeatable.
  --enable-browser        Opt in to the Admin-only Playwright browser capability. Disabled by default.
  --enable-computer-use   Opt in to the Admin-only native Computer Runtime. Disabled by default.
  --enable-full-host-js   Opt in to full-host Node.js for Computer Runtime; requires --enable-computer-use. Disabled by default.
  --browser-headless      Run the opted-in browser headlessly; requires --enable-browser.
  --browser-existing-chrome
                          Attach browser tools to the user's already-running Chrome; requires --enable-browser.
  --browser-existing-chrome-user-data-dir <path>
                          Override the Chrome user-data directory used for local debugging discovery.
  --force                 Replace an existing tunnel-client profile. Never implied.
  --doctor                Create the profile, then run tunnel-client doctor.
  --run                   Create the profile, run doctor, then run the tunnel.
  --help                  Show this help.

The generated ChatGPT tunnel target always enables the private local authority
control socket at ~/.chatgpt-system/control.sock. By default User/Admin leases are created
outside ChatGPT with:
  chatgpt-system authorize user
  chatgpt-system authorize admin

With --personal-admin, ChatGPT may mint short-lived Admin leases directly.
User authority remains locally approved.

Browser automation is disabled unless --enable-browser is supplied. Browser tools
remain Admin-only even when the runtime browser gate is enabled. Install the pinned
Playwright Chromium binary separately with:
  npm run setup:browser

User/Admin session authority on macOS requires the protected native broker.
Build and install it separately:
  npm run build:broker:macos
  sudo npm run install:broker:macos

Project authority remains available when the protected broker is absent and has
no host terminal capability. Sandboxed Project execution is a separate explicit
opt-in. User authority requires local approval and has no terminal capability.
Admin authority requires local approval and is the only host terminal-capable profile.

Credentials are not accepted as command-line arguments. tunnel-client reads
CONTROL_PLANE_API_KEY (or its currently supported credential mechanism) from
the runtime environment.`);
}

function parseArgs(argv) {
  const options = {
    root: undefined,
    tunnelId: undefined,
    profile: "chatgpt-system",
    terminal: false,
    projectExec: false,
    personalAdmin: false,
    ownerRuntime: false,
    ownerShellPath: undefined,
    browser: false,
    computerUse: false,
    fullHostJs: false,
    browserHeadless: false,
    browserExistingChrome: false,
    browserExistingChromeUserDataDir: undefined,
    commands: [],
    force: false,
    doctor: false,
    run: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--enable-terminal") {
      options.terminal = true;
      continue;
    }
    if (arg === "--enable-project-exec") {
      options.projectExec = true;
      continue;
    }
    if (arg === "--personal-admin") {
      options.personalAdmin = true;
      continue;
    }
    if (arg === "--enable-owner-runtime") {
      options.ownerRuntime = true;
      continue;
    }
    if (arg === "--enable-browser") {
      options.browser = true;
      continue;
    }
    if (arg === "--enable-computer-use") {
      options.computerUse = true;
      continue;
    }
    if (arg === "--enable-full-host-js") {
      options.fullHostJs = true;
      continue;
    }
    if (arg === "--browser-headless") {
      options.browserHeadless = true;
      continue;
    }
    if (arg === "--browser-existing-chrome") {
      options.browserExistingChrome = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--doctor") {
      options.doctor = true;
      continue;
    }
    if (arg === "--run") {
      options.run = true;
      continue;
    }

    if (["--root", "--tunnel-id", "--profile", "--allow-command", "--owner-shell-path", "--browser-existing-chrome-user-data-dir"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === "--root") {
        if (options.root !== undefined) throw new Error("--root may be supplied only once for the personal ChatGPT tunnel profile.");
        options.root = value;
      }
      if (arg === "--tunnel-id") options.tunnelId = value;
      if (arg === "--profile") options.profile = value;
      if (arg === "--allow-command") options.commands.push(value);
      if (arg === "--owner-shell-path") options.ownerShellPath = value;
      if (arg === "--browser-existing-chrome-user-data-dir") options.browserExistingChromeUserDataDir = value;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function quoteCommandArg(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function redactExistingChromeUserDataDir(commandParts) {
  const redacted = [...commandParts];
  const flagIndex = redacted.indexOf("--browser-existing-chrome-user-data-dir");
  if (flagIndex >= 0 && redacted[flagIndex + 1] !== undefined) {
    redacted[flagIndex + 1] = "<redacted-chrome-user-data-dir>";
  }
  return redacted;
}

function normalizeRoot(requestedRoot, homeDir) {
  if (!requestedRoot) throw new Error("--root is required. Refusing to guess what ChatGPT should be allowed to access.");
  if (!path.isAbsolute(requestedRoot)) throw new Error("--root must be an absolute path.");

  const root = path.resolve(requestedRoot);
  const filesystemRoot = path.parse(root).root;
  if (root === filesystemRoot) throw new Error("Refusing to grant the filesystem root directory to ChatGPT.");
  if (root === path.resolve(homeDir)) throw new Error("Refusing to grant the entire home directory to ChatGPT. Choose a narrower project root.");
  return root;
}

export async function validateRootBoundary(root, homeDir) {
  const [canonicalRoot, canonicalHome] = await Promise.all([
    realpath(root),
    realpath(homeDir),
  ]);

  const filesystemRoot = path.parse(canonicalRoot).root;
  if (canonicalRoot === filesystemRoot) {
    throw new Error("Refusing to grant the filesystem root directory to ChatGPT, including through a symlink alias.");
  }
  if (canonicalRoot === canonicalHome) {
    throw new Error("Refusing to grant the entire home directory to ChatGPT, including through a symlink alias. Choose a narrower project root.");
  }

  const rootInfo = await stat(canonicalRoot);
  if (!rootInfo.isDirectory()) throw new Error(`Configured --root is not a directory: ${root}`);
  return canonicalRoot;
}

export function buildTunnelSetup(argv, _env = {}, context = {}) {
  const options = parseArgs(argv);
  if (options.help) return { help: true };

  const repoDir = path.resolve(context.repoDir ?? defaultRepoDir);
  const homeDir = path.resolve(context.homeDir ?? homedir());
  const root = normalizeRoot(options.root, homeDir);

  if (!options.tunnelId || !/^tunnel_[A-Za-z0-9_-]{8,}$/.test(options.tunnelId)) {
    throw new Error("Tunnel ID must start with 'tunnel_' and contain a plausible OpenAI tunnel identifier.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(options.profile)) {
    throw new Error("--profile may contain only letters, numbers, '-' and '_'.");
  }
  if (options.commands.length > 0 && !options.terminal) {
    throw new Error("--allow-command requires --enable-terminal.");
  }
  if (options.ownerRuntime && !options.personalAdmin) {
    throw new Error("--enable-owner-runtime requires --personal-admin.");
  }
  if (options.ownerShellPath !== undefined && !options.ownerRuntime) {
    throw new Error("--owner-shell-path requires --enable-owner-runtime.");
  }
  if (options.ownerShellPath !== undefined && !path.isAbsolute(options.ownerShellPath)) {
    throw new Error("--owner-shell-path must be an absolute path.");
  }
  if (options.browserHeadless && !options.browser) {
    throw new Error("--browser-headless requires --enable-browser.");
  }
  if (options.browserExistingChrome && !options.browser) {
    throw new Error("--browser-existing-chrome requires --enable-browser.");
  }
  if (options.browserExistingChrome && options.browserHeadless) {
    throw new Error("--browser-existing-chrome cannot be combined with --browser-headless.");
  }
  if (options.browserExistingChromeUserDataDir !== undefined && !options.browserExistingChrome) {
    throw new Error("--browser-existing-chrome-user-data-dir requires --browser-existing-chrome.");
  }
  if (options.fullHostJs && !options.computerUse) {
    throw new Error("--enable-full-host-js requires --enable-computer-use.");
  }
  for (const command of options.commands) {
    if (command !== path.basename(command)) throw new Error("--allow-command values must be executable basenames, not paths.");
    if (!/^[A-Za-z0-9._+-]+$/.test(command)) throw new Error(`Invalid command basename: ${command}`);
  }

  const serverPath = path.join(repoDir, "dist", "cli.js");
  const brokerPackageDir = path.join(repoDir, "native", "macos-authority-broker");
  const brokerBuildPath = path.join(
    brokerPackageDir,
    ".build",
    "release",
    "chatgpt-system-authority-broker",
  );
  const controlSocketPath = path.join(homeDir, ".chatgpt-system", "control.sock");
  const computerRuntimeBundlePath = path.join(
    homeDir,
    ".chatgpt-system",
    "ChatGPTSystemComputerRuntime.app",
  );
  const commandParts = [
    process.execPath,
    serverPath,
    "stdio",
    "--root", root,
    "--enable-control",
    "--control-socket", controlSocketPath,
  ];
  if (options.terminal) commandParts.push("--enable-terminal");
  if (options.projectExec) commandParts.push("--enable-project-exec");
  if (options.personalAdmin) commandParts.push("--personal-admin");
  if (options.ownerRuntime) commandParts.push("--enable-owner-runtime");
  if (options.ownerShellPath !== undefined) commandParts.push("--owner-shell-path", options.ownerShellPath);
  if (options.browser) commandParts.push("--enable-browser");
  if (options.computerUse) commandParts.push("--enable-computer-use");
  if (options.fullHostJs) commandParts.push("--enable-full-host-js");
  if (options.browserHeadless) commandParts.push("--browser-headless");
  if (options.browserExistingChrome) commandParts.push("--browser-existing-chrome");
  if (options.browserExistingChromeUserDataDir !== undefined) {
    commandParts.push("--browser-existing-chrome-user-data-dir", options.browserExistingChromeUserDataDir);
  }
  for (const command of options.commands) commandParts.push("--allow-command", command);
  const mcpCommand = commandParts.map(quoteCommandArg).join(" ");
  const displayMcpCommand = redactExistingChromeUserDataDir(commandParts).map(quoteCommandArg).join(" ");
  const initArgs = [
    "init",
    "--sample", "sample_mcp_stdio_local",
    "--profile", options.profile,
    "--tunnel-id", options.tunnelId,
    "--mcp-command", mcpCommand,
    ...(options.force ? ["--force"] : []),
  ];
  const displayInitArgs = initArgs.map((value, index) => (
    index > 0 && initArgs[index - 1] === "--mcp-command" ? displayMcpCommand : value
  ));

  return {
    profile: options.profile,
    root,
    tunnelId: options.tunnelId,
    serverPath,
    controlSocketPath,
    projectExecEnabled: options.projectExec,
    ownerRuntimeEnabled: options.ownerRuntime,
    computerUseEnabled: options.computerUse,
    fullHostJsEnabled: options.fullHostJs,
    computerRuntimeBundlePath,
    brokerPackageDir,
    brokerBuildPath,
    brokerHelperPath: protectedBrokerHelperPath,
    brokerMetadataPath: protectedBrokerMetadataPath,
    mcpCommand,
    displayMcpCommand,
    initArgs,
    displayInitArgs,
    doctorArgs: ["doctor", "--profile", options.profile, "--explain"],
    runArgs: ["run", "--profile", options.profile],
    executeDoctor: options.doctor || options.run,
    executeRun: options.run,
  };
}

function printableCommand(command, args) {
  return [command, ...args].map(quoteCommandArg).join(" ");
}

function runTunnelClient(args, { capture = false } = {}) {
  return spawnSync("tunnel-client", args, {
    shell: false,
    encoding: "utf8",
    env: process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function assertSuccessful(result, label) {
  if (result.error?.code === "ENOENT") throw new Error("tunnel-client was not found on PATH. Install the current OpenAI tunnel-client release first.");
  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ` with exit code ${result.status}`}.`);
  }
}

async function inspectProtectedBroker() {
  if (process.platform !== "darwin") return { available: false, reason: "not-macos" };
  try {
    const module = await import("../dist/native-helper-trust.js");
    const validator = new module.MacOSNativeHelperTrustValidator();
    await validator.validate();
    return { available: true };
  } catch {
    return { available: false, reason: "missing-or-untrusted" };
  }
}

export async function validateComputerUseReadiness(
  setup,
  inspector = inspectInstalledComputerRuntime,
) {
  if (!setup.computerUseEnabled) return { required: false, ready: true };
  const state = await inspector(setup.computerRuntimeBundlePath);
  if (!state?.available) {
    throw new Error(
      `Computer Runtime is ${state?.reason ?? "missing-or-untrusted"}. Run 'npm run setup:computer:macos' before enabling computer use.`,
    );
  }
  return {
    required: true,
    ready: true,
    tccIdentityStable: state.tccIdentityStable === true,
  };
}

async function validateRuntime(setup) {
  await access(setup.serverPath);
  await validateRootBoundary(setup.root, homedir());
  const broker = await inspectProtectedBroker();
  if (process.platform === "darwin" && !broker.available) {
    console.warn(
      "[chatgpt-system] Protected macOS authority broker is missing or untrusted. Project authority remains available; User/Admin local authorization will fail closed until you run 'npm run build:broker:macos' and 'sudo npm run install:broker:macos'.",
    );
  }

  const computer = await validateComputerUseReadiness(setup);
  if (computer.required && !computer.tccIdentityStable) {
    console.warn(
      "[chatgpt-system] Computer Runtime is installed with development-only ad-hoc signing. It is usable, but macOS TCC identity will not be stable across rebuilds.",
    );
  }

  const versionCheck = runTunnelClient(["help", "quickstart"], { capture: true });
  assertSuccessful(versionCheck, "tunnel-client preflight");
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }

  const setup = buildTunnelSetup(argv, process.env, {
    repoDir: defaultRepoDir,
    homeDir: homedir(),
  });

  console.log("Secure MCP Tunnel profile plan:");
  console.log(`  Root: ${setup.root}`);
  console.log(`  Profile: ${setup.profile}`);
  console.log(`  MCP command: ${setup.displayMcpCommand}`);
  console.log(`  Local authority control socket: ${setup.controlSocketPath}`);
  console.log(`  Native broker build: ${setup.brokerBuildPath}`);
  console.log(`  Protected native broker: ${setup.brokerHelperPath}`);
  console.log(`  Protected broker metadata: ${setup.brokerMetadataPath}`);
  console.log(`  Init: ${printableCommand("tunnel-client", setup.displayInitArgs)}`);
  console.log(`  Doctor: ${printableCommand("tunnel-client", setup.doctorArgs)}`);
  console.log(`  Run: ${printableCommand("tunnel-client", setup.runArgs)}`);
  console.log("  Bootstrap terminal: " + (setup.mcpCommand.includes("--enable-terminal") ? "EXPLICITLY ENABLED" : "disabled"));
  console.log("  Project execution: " + (setup.projectExecEnabled ? "EXPLICITLY ENABLED (Docker sandbox)" : "disabled"));
  console.log("  Personal Admin: " + (setup.mcpCommand.includes("--personal-admin") ? "EXPLICITLY ENABLED" : "disabled"));
  console.log("  Owner Runtime: " + (setup.ownerRuntimeEnabled ? "EXPLICITLY ENABLED" : "disabled"));
  console.log("  Browser: " + (setup.mcpCommand.includes("--enable-browser") ? (setup.mcpCommand.includes("--browser-headless") ? "EXPLICITLY ENABLED (headless)" : "EXPLICITLY ENABLED (headed)") : "disabled"));
  console.log("  Computer Runtime: " + (setup.mcpCommand.includes("--enable-computer-use") ? "EXPLICITLY ENABLED" : "disabled"));
  console.log("  Full-host JavaScript: " + (setup.fullHostJsEnabled ? "EXPLICITLY ENABLED" : "disabled"));
  if (setup.computerUseEnabled) console.log(`  Computer Runtime bundle: ${setup.computerRuntimeBundlePath}`);
  console.log("  Local User/Admin authorization: enabled through private Unix socket");

  if (!setup.executeDoctor && !setup.executeRun) {
    console.log("\nDry setup only. Re-run with --doctor to validate local components and create the profile, or --run to also start it.");
    return;
  }

  await validateRuntime(setup);

  assertSuccessful(runTunnelClient(setup.initArgs), "tunnel-client init");
  assertSuccessful(runTunnelClient(setup.doctorArgs), "tunnel-client doctor");

  if (setup.executeRun) {
    assertSuccessful(runTunnelClient(setup.runArgs), "tunnel-client run");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[chatgpt-system] ChatGPT tunnel setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
