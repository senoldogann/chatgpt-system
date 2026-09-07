import { spawn } from "node:child_process";
import { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { PolicyError } from "./errors.js";
import { PathPolicy } from "./policy.js";

interface GitResult {
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class GitService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly config: AppConfig,
  ) {}

  private async run(cwdInput: string, args: string[]): Promise<GitResult> {
    const cwd = await this.policy.resolve(cwdInput);
    return this.audit.run("git.read", this.policy.display(cwd), async () => {
      return new Promise<GitResult>((resolve, reject) => {
        const child = spawn(
          "git",
          [
            "-c", "core.hooksPath=/dev/null",
            "-c", "core.fsmonitor=false",
            "-c", "diff.external=",
            "-c", "interactive.diffFilter=",
            ...args,
          ],
          {
            cwd,
            shell: false,
            env: {
              ...process.env,
              GIT_OPTIONAL_LOCKS: "0",
              GIT_PAGER: "cat",
              PAGER: "cat",
              GIT_TERMINAL_PROMPT: "0",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let bytes = 0;
        let tooLarge = false;
        const collect = (target: Buffer[]) => (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > this.config.limits.maxCommandOutputBytes) {
            tooLarge = true;
            child.kill("SIGKILL");
            return;
          }
          target.push(chunk);
        };
        child.stdout.on("data", collect(stdout));
        child.stderr.on("data", collect(stderr));
        child.once("error", reject);
        child.once("close", (code) => {
          if (tooLarge) {
            reject(new PolicyError("Git output exceeded the configured limit."));
            return;
          }
          resolve({
            cwd: this.policy.display(cwd),
            exitCode: code ?? 1,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
          });
        });
      });
    }, { args });
  }

  async status(cwd = "."): Promise<GitResult> {
    return this.run(cwd, ["status", "--porcelain=v1", "--branch"]);
  }

  async diff(cwd = ".", staged = false): Promise<GitResult> {
    return this.run(cwd, ["diff", "--no-ext-diff", "--no-textconv", ...(staged ? ["--cached"] : [])]);
  }

  async log(cwd = ".", limit = 20): Promise<GitResult> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new PolicyError("Git log limit must be between 1 and 100.");
    return this.run(cwd, ["log", `-${limit}`, "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%an%x09%s"]);
  }
}
