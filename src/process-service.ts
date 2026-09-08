import { spawn } from "node:child_process";
import { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { LimitError } from "./errors.js";
import { PathPolicy } from "./policy.js";
import {
  sanitizedChildEnvironment,
  validateProcessInvocation,
} from "./process-policy.js";

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

export class ProcessService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly config: AppConfig,
  ) {}

  async run(command: string, args: string[], cwdInput = "."): Promise<ProcessResult> {
    validateProcessInvocation(this.config.terminal, command, args);

    const cwd = await this.policy.resolve(cwdInput);
    return this.audit.run("process.run", this.policy.display(cwd), async () => {
      return new Promise<ProcessResult>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd,
          shell: false,
          env: sanitizedChildEnvironment(),
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
