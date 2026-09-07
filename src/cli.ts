#!/usr/bin/env node
import { loadConfig, type ConfigOverrides } from "./config.js";
import { createRuntimeServices } from "./server.js";
import { startHttp, startStdio } from "./transport.js";

interface ParsedArgs extends ConfigOverrides {
  mode: "stdio" | "http";
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: "stdio" | "http" = "stdio";
  const roots: string[] = [];
  const commands: string[] = [];
  const parsed: ParsedArgs = { mode, help: false };

  const takeValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "stdio" || arg === "http") {
      mode = arg;
      parsed.mode = mode;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--enable-terminal") {
      parsed.terminalEnabled = true;
      continue;
    }
    if (arg === "--root") {
      roots.push(takeValue(i, arg));
      i += 1;
      continue;
    }
    if (arg === "--allow-command") {
      commands.push(takeValue(i, arg));
      i += 1;
      continue;
    }
    if (["--audit-file", "--host", "--port", "--token"].includes(arg)) {
      const value = takeValue(i, arg);
      if (arg === "--audit-file") parsed.auditFile = value;
      if (arg === "--host") parsed.host = value;
      if (arg === "--port") parsed.port = Number(value);
      if (arg === "--token") parsed.token = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (roots.length) parsed.roots = roots;
  if (commands.length) parsed.commands = commands;
  return parsed;
}

function printHelp(): void {
  console.log(`chatgpt-system - secure local MCP bridge

Usage:
  chatgpt-system stdio [options]
  chatgpt-system http [options]

Options:
  --root <path>             Allow a filesystem root (repeatable). Defaults to cwd.
  --audit-file <path>       JSONL audit log path.
  --enable-terminal         Enable terminal_run. Disabled by default.
  --allow-command <name>    Terminal executable allowlist (repeatable).
  --host <host>             HTTP bind host. Default: 127.0.0.1.
  --port <number>           HTTP port. Default: 4312.
  --token <secret>          HTTP bearer token, minimum 16 characters.
  -h, --help                Show this help.

Security:
  Filesystem tools are confined to explicit roots and reject symlink escapes.
  Existing file writes/removals require the SHA-256 returned by fs_read/fs_stat.
  terminal_run is opt-in and is NOT an operating-system sandbox.
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.token && args.token.length < 16) throw new Error("--token must be at least 16 characters.");
  if (args.port !== undefined && (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535)) {
    throw new Error("--port must be an integer between 1 and 65535.");
  }

  const { mode, help: _help, ...overrides } = args;
  const config = await loadConfig(overrides);
  const runtime = createRuntimeServices(config);

  if (mode === "stdio") {
    const stdio = startStdio(runtime);
    const close = () => void stdio.close().finally(() => process.exit(0));
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    console.error(`[chatgpt-system] stdio ready; roots=${config.roots.join(",")}; terminal=${config.terminal.enabled ? "enabled" : "disabled"}`);
    return;
  }

  const server = startHttp(runtime);
  server.once("listening", () => {
    console.error(`[chatgpt-system] HTTP MCP listening on http://${config.http.host}:${config.http.port}/mcp`);
  });
  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error) => {
  console.error(`[chatgpt-system] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
