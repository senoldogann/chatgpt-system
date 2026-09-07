#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoDir = path.resolve(path.dirname(scriptPath), "..");

function usage() {
  console.log(`Usage:
  npm run setup:chatgpt -- --root /absolute/path/to/project --tunnel-id tunnel_... [options]

Options:
  --root <path>           Explicit filesystem root. Required.
  --tunnel-id <id>        OpenAI Secure MCP Tunnel ID. Required.
  --profile <name>        tunnel-client profile name (default: chatgpt-system).
  --enable-terminal       Opt in to terminal_run. Disabled by default.
  --allow-command <name>  Allowlisted terminal executable basename. Repeatable.
  --doctor                Create the profile, then run tunnel-client doctor.
  --run                   Create the profile, run doctor, then run the tunnel.
  --help                  Show this help.

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
    commands: [],
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
    if (arg === "--doctor") {
      options.doctor = true;
      continue;
    }
    if (arg === "--run") {
      options.run = true;
      continue;
    }

    if (["--root", "--tunnel-id", "--profile", "--allow-command"].includes(arg)) {
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

function normalizeRoot(requestedRoot, homeDir) {
  if (!requestedRoot) throw new Error("--root is required. Refusing to guess what ChatGPT should be allowed to access.");
  if (!path.isAbsolute(requestedRoot)) throw new Error("--root must be an absolute path.");

  const root = path.resolve(requestedRoot);
  const filesystemRoot = path.parse(root).root;
  if (root === filesystemRoot) throw new Error("Refusing to grant the filesystem root directory to ChatGPT.");
  if (root === path.resolve(homeDir)) throw new Error("Refusing to grant the entire home directory to ChatGPT. Choose a narrower project root.");
  return root;
}

export function buildTunnelSetup(argv, _env = {}, context = {}) {
  const options = parseArgs(argv);
  if (options.help) return { help: true };

  const repoDir = path.resolve(context.repoDir ?? defaultRepoDir);
  const homeDir = context.homeDir ?? homedir();
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
  for (const command of options.commands) {
    if (command !== path.basename(command)) throw new Error("--allow-command values must be executable basenames, not paths.");
    if (!/^[A-Za-z0-9._+-]+$/.test(command)) throw new Error(`Invalid command basename: ${command}`);
  }

  const serverPath = path.join(repoDir, "dist", "cli.js");
  const commandParts = [process.execPath, serverPath, "stdio", "--root", root];
  if (options.terminal) commandParts.push("--enable-terminal");
  for (const command of options.commands) commandParts.push("--allow-command", command);
  const mcpCommand = commandParts.map(quoteCommandArg).join(" ");

  return {
    profile: options.profile,
    root,
    tunnelId: options.tunnelId,
    serverPath,
    mcpCommand,
    initArgs: [
      "init",
      "--sample", "sample_mcp_stdio_local",
      "--profile", options.profile,
      "--tunnel-id", options.tunnelId,
      "--mcp-command", mcpCommand,
    ],
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

async function validateRuntime(setup) {
  await access(setup.serverPath);
  const rootInfo = await stat(setup.root);
  if (!rootInfo.isDirectory()) throw new Error(`Configured --root is not a directory: ${setup.root}`);

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
  console.log(`  MCP command: ${setup.mcpCommand}`);
  console.log(`  Init: ${printableCommand("tunnel-client", setup.initArgs)}`);
  console.log(`  Doctor: ${printableCommand("tunnel-client", setup.doctorArgs)}`);
  console.log(`  Run: ${printableCommand("tunnel-client", setup.runArgs)}`);
  console.log("  Terminal: " + (setup.mcpCommand.includes("--enable-terminal") ? "EXPLICITLY ENABLED" : "disabled"));

  if (!setup.executeDoctor && !setup.executeRun) {
    console.log("\nDry setup only. Re-run with --doctor to create/validate the profile, or --run to create, validate, and start it.");
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
