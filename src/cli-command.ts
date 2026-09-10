import { parseAuthorizeArgs, type AuthorizeArgs } from "./authorize-cli.js";
import type { ConfigOverrides } from "./config.js";

export interface AuthorizeCliCommand {
  kind: "authorize";
  args: AuthorizeArgs;
}

export interface ServerCliCommand {
  kind: "server";
  mode: "stdio" | "http";
  help: boolean;
  overrides: ConfigOverrides;
}

export type CliCommand = AuthorizeCliCommand | ServerCliCommand;

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function takePositiveInteger(argv: string[], index: number, flag: string): number {
  const raw = takeValue(argv, index, flag);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return value;
}

export function parseCliCommand(argv: string[]): CliCommand {
  if (argv[0] === "authorize") {
    return { kind: "authorize", args: parseAuthorizeArgs(argv.slice(1)) };
  }

  let mode: "stdio" | "http" = "stdio";
  let help = false;
  let controlEnabled = false;
  let controlSocketPath: string | undefined;
  const roots: string[] = [];
  const commands: string[] = [];
  const overrides: ConfigOverrides = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "stdio" || arg === "http") {
      mode = arg;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--enable-terminal") {
      overrides.terminalEnabled = true;
      continue;
    }
    if (arg === "--personal-admin") {
      overrides.personalAdminEnabled = true;
      continue;
    }
    if (arg === "--enable-computer-use") {
      overrides.computerUseEnabled = true;
      continue;
    }
    if (arg === "--enable-full-host-js") {
      overrides.fullHostJsEnabled = true;
      continue;
    }
    if (arg === "--enable-browser") {
      overrides.browserEnabled = true;
      continue;
    }
    if (arg === "--browser-headless") {
      overrides.browserHeadless = true;
      continue;
    }
    if (arg === "--browser-timeout-ms") {
      overrides.browserTimeoutMs = takePositiveInteger(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--browser-user-data-dir") {
      overrides.browserUserDataDir = takeValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--enable-control") {
      controlEnabled = true;
      overrides.controlEnabled = true;
      continue;
    }
    if (arg === "--root") {
      roots.push(takeValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--allow-command") {
      commands.push(takeValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (["--audit-file", "--host", "--port", "--token", "--control-socket"].includes(arg)) {
      const value = takeValue(argv, index, arg);
      if (arg === "--audit-file") overrides.auditFile = value;
      if (arg === "--host") overrides.host = value;
      if (arg === "--port") overrides.port = Number(value);
      if (arg === "--token") overrides.token = value;
      if (arg === "--control-socket") controlSocketPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (controlSocketPath !== undefined) {
    if (!controlEnabled) throw new Error("--control-socket requires --enable-control.");
    overrides.controlSocketPath = controlSocketPath;
  }
  if (roots.length > 0) overrides.roots = roots;
  if (commands.length > 0) overrides.commands = commands;

  return { kind: "server", mode, help, overrides };
}
