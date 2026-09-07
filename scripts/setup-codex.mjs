#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(repoRoot, "dist", "cli.js");

function usage() {
  console.log(`Usage:
  npm run setup:codex -- --root /absolute/path/to/project [options]

Options:
  --root <path>           Allowed filesystem root. Repeatable and required.
  --name <name>           Codex MCP server name (default: chatgpt-system).
  --enable-terminal       Opt in to terminal_run.
  --allow-command <name>  Replace terminal command allowlist. Repeatable.
  --help                  Show this help.

The installer registers chatgpt-system as a local stdio MCP server using
Codex's own 'codex mcp add' command. Existing registration with the same
name is replaced deliberately.`);
}

function parseArgs(argv) {
  const options = {
    roots: [],
    name: "chatgpt-system",
    terminal: false,
    commands: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
    if (arg === "--enable-terminal") {
      options.terminal = true;
      continue;
    }

    const value = argv[i + 1];
    if (arg === "--root" || arg === "--name" || arg === "--allow-command") {
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      i += 1;
      if (arg === "--root") options.roots.push(value);
      if (arg === "--name") options.name = value;
      if (arg === "--allow-command") options.commands.push(value);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  if (options.roots.length === 0) throw new Error("At least one --root is required. Refusing to guess what Codex should be allowed to access.");
  if (!/^[A-Za-z0-9_-]+$/.test(options.name)) throw new Error("--name may contain only letters, numbers, '-' and '_'.");
  if (options.commands.length > 0 && !options.terminal) throw new Error("--allow-command requires --enable-terminal.");

  await access(serverPath);
  const roots = [];
  for (const requested of options.roots) roots.push(await realpath(path.resolve(requested)));

  const codexVersion = run("codex", ["--version"], { capture: true });
  if (codexVersion.error?.code === "ENOENT") throw new Error("Codex CLI was not found on PATH. Install/sign in to Codex first.");
  if (codexVersion.status !== 0) throw new Error(`Unable to execute Codex CLI: ${codexVersion.stderr?.trim() || `exit ${codexVersion.status}`}`);

  const existing = run("codex", ["mcp", "get", options.name, "--json"], { capture: true });
  if (existing.status === 0) {
    const removed = run("codex", ["mcp", "remove", options.name]);
    if (removed.status !== 0) throw new Error(`Could not replace existing MCP registration '${options.name}'.`);
  }

  const serverArgs = [serverPath, "stdio"];
  for (const root of roots) serverArgs.push("--root", root);
  if (options.terminal) serverArgs.push("--enable-terminal");
  for (const command of options.commands) serverArgs.push("--allow-command", command);

  const added = run("codex", ["mcp", "add", options.name, "--", process.execPath, ...serverArgs]);
  if (added.status !== 0) throw new Error(`codex mcp add failed with exit code ${added.status}.`);

  const verify = run("codex", ["mcp", "get", options.name, "--json"], { capture: true });
  if (verify.status !== 0) throw new Error("Codex accepted the add command but the MCP registration could not be read back.");

  console.log(`\nRegistered '${options.name}' for Codex.`);
  console.log(verify.stdout.trim());
  console.log("\nOpen a new Codex local session and inspect /mcp. Terminal access remains disabled unless you explicitly enabled it above.");
}

main().catch((error) => {
  console.error(`[chatgpt-system] Codex setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
