import { spawn } from "node:child_process";
import { basename } from "node:path";
import { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { LimitError, PolicyError } from "./errors.js";
import { PathPolicy } from "./policy.js";

export interface ProcessResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

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

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }
  result.CI = "1";
  result.NO_COLOR = "1";
  return result;
}

export class ProcessService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly config: AppConfig,
  ) {}

  async run(command: string, args: string[], cwdInput = "."): Promise<ProcessResult> {
    if (!this.config.terminal.enabled) {
      throw new PolicyError("Terminal execution is disabled. Restart with --enable-terminal or CHATGPT_SYSTEM_ENABLE_TERMINAL=true.");
    }
    if (command !== basename(command) || !this.config.terminal.commands.includes(command)) {
      throw new PolicyError("Command is not allowlisted.", { command, allowed: this.config.terminal.commands });
    }
    if (args.some((arg) => arg.includes("\u0000"))) throw new PolicyError("Command arguments may not contain NUL bytes.");

    const cwd = await this.policy.resolve(cwdInput);
    return this.audit.run("process.run", this.policy.display(cwd), async () => {
      return new Promise<ProcessResult>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          shell: false,
          env: sanitizedEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
        });

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let timedOut = false;
        let outputLimited = false;

        const collect = (target: Buffer[]) => (chunk: Buffer) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > this.config.limits.maxCommandOutputBytes) {
            outputLimited = true;
            child.kill("SIGKILL");
            return;
          }
          target.push(chunk);
        };

        child.stdout.on("data", collect(stdout));
        child.stderr.on("data", collect(stderr));
        child.once("error", reject);

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, this.config.limits.commandTimeoutMs);
        timer.unref();

        child.once("close", (exitCode, signal) => {
          clearTimeout(timer);
          if (outputLimited) {
            reject(new LimitError("Command output exceeded configured byte limit.", { limit: this.config.limits.maxCommandOutputBytes }));
            return;
          }
          resolve({
            command,
            args,
            cwd: this.policy.display(cwd),
            exitCode,
            signal,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            timedOut,
          });
        });
      });
    }, { command, argCount: args.length });
  }
}
