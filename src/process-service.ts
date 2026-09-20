import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { CommandTimeoutError, ExecutableNotFoundError, LimitError, ProcessTerminationFailedError } from "./errors.js";
import { resolveExecutablePath } from "./executable-resolution.js";
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
    // Allowlist basename'i korur; PATH'te bulunamayan kullanıcı-local binary'ler
    // (örn. ~/.local/bin/uv) için çözümlenmiş mutlak yolu spawn eder.
    // Çözümleme başarısız olursa OS aramasını dener, ENOENT structured hataya döner.
    const executablePath = (await resolveExecutablePath(command, {
      pathValue: process.env.PATH,
      homeDir: homedir(),
    })) ?? command;
    return this.audit.run("process.run", this.policy.display(cwd), async () => {
      return new Promise<ProcessResult>((resolve, reject) => {
        // Süreç grubu lideri olarak başlatılır: boruları miras alan torunlar
        // yalnız doğrudan çocuk öldürüldüğünde hayatta kalır ve çağrıyı
        // hosted yanıt süresinin ötesine taşır.
        const detached = process.platform !== "win32";
        const child = spawn(executablePath, args, {
          cwd,
          shell: false,
          env: sanitizedChildEnvironment(),
          stdio: ["ignore", "pipe", "pipe"],
          detached,
        });

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const timers: NodeJS.Timeout[] = [];
        let outputBytes = 0;
        let timedOut = false;
        let outputLimited = false;
        let settled = false;

        const schedule = (handler: () => void, delayMs: number): void => {
          const timer = setTimeout(handler, delayMs);
          timer.unref();
          timers.push(timer);
        };

        const finish = (settle: () => void): void => {
          if (settled) return;
          settled = true;
          for (const timer of timers) clearTimeout(timer);
          child.stdout.destroy();
          child.stderr.destroy();
          settle();
        };

        const signalTree = (signal: NodeJS.Signals): void => {
          const pid = child.pid;
          if (pid === undefined) {
            child.kill(signal);
            return;
          }
          try {
            if (detached) process.kill(-pid, signal);
            else child.kill(signal);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
            finish(() => reject(new ProcessTerminationFailedError(command, signal)));
          }
        };

        const graceMs = this.config.limits.processStopGraceMs;
        const requestTermination = (): void => {
          signalTree("SIGTERM");
          schedule(() => signalTree("SIGKILL"), graceMs);
        };

        const collect = (target: Buffer[]) => (chunk: Buffer) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > this.config.limits.maxCommandOutputBytes) {
            if (outputLimited) return;
            outputLimited = true;
            requestTermination();
            schedule(() => finish(() => reject(this.outputLimitError())), graceMs * 2);
            return;
          }
          target.push(chunk);
        };

        child.stdout.on("data", collect(stdout));
        child.stderr.on("data", collect(stderr));
        child.once("error", (error: Error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            finish(() => reject(new ExecutableNotFoundError(command)));
            return;
          }
          finish(() => reject(error));
        });

        const commandTimeoutMs = this.config.limits.commandTimeoutMs;
        schedule(() => {
          timedOut = true;
          requestTermination();
          // Sızan bir torun borusu açık tutsa bile çağrı kesin bir üst sınırda
          // sonuçlanır; hosted yanıt süresi asla bu yüzden aşılmaz.
          schedule(() => finish(() => reject(new CommandTimeoutError(commandTimeoutMs, { command }))), graceMs * 2);
        }, commandTimeoutMs);

        child.once("close", (exitCode, signal) => {
          if (outputLimited) {
            finish(() => reject(this.outputLimitError()));
            return;
          }
          // Timeout kasıtlı olarak hata verir; managed process'e otomatik
          // dönüşüm yoktur. Agent process_start + polling kullanmalıdır.
          if (timedOut) {
            finish(() => reject(new CommandTimeoutError(commandTimeoutMs, { command })));
            return;
          }
          finish(() => resolve({
            command,
            args,
            cwd: this.policy.display(cwd),
            exitCode,
            signal,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            timedOut,
          }));
        });
      });
    }, { command, argCount: args.length });
  }

  private outputLimitError(): LimitError {
    return new LimitError("Command output exceeded configured byte limit.", {
      limit: this.config.limits.maxCommandOutputBytes,
    });
  }
}
