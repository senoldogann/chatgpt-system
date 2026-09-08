import { basename } from "node:path";
import { PolicyError } from "./errors.js";

const SAFE_ENV_KEYS = [
  "HOME",
  "USER",
  "LOGNAME",
  "PATH",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "SHELL",
  "TERM",
  "SSH_AUTH_SOCK",
] as const;

export function validateProcessInvocation(
  terminal: { enabled: boolean; commands: string[] },
  command: string,
  args: string[],
): void {
  if (!terminal.enabled) {
    throw new PolicyError(
      "Terminal execution is disabled. Restart with --enable-terminal or CHATGPT_SYSTEM_ENABLE_TERMINAL=true.",
    );
  }
  if (command !== basename(command) || !terminal.commands.includes(command)) {
    throw new PolicyError("Command is not allowlisted.", {
      command,
      allowed: terminal.commands,
    });
  }
  if (args.some((arg) => arg.includes("\u0000"))) {
    throw new PolicyError("Command arguments may not contain NUL bytes.");
  }
}

export function sanitizedChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  result.CI = "1";
  result.NO_COLOR = "1";
  return result;
}
