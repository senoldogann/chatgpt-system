import { createHash } from "node:crypto";
import type { AuditLogger } from "../core/audit.js";
import type { OwnerRuntimeConfig } from "../core/config.js";
import { HostedResponseBudgetError, LimitError, OwnerRuntimeDisabledError, PolicyError } from "../core/errors.js";
import type { OwnerShellBackend, OwnerShellRunResult } from "./owner-shell-supervisor.js";
import type { PathPolicy } from "../core/policy.js";

export interface OwnerShellRunInput {
  script: string;
  cwd?: string;
  timeoutMs?: number | null;
  signal?: AbortSignal;
}

export class OwnerShellService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly supervisor: OwnerShellBackend,
    private readonly config: OwnerRuntimeConfig,
    private readonly adminEnabled: boolean,
  ) {}

  async run(input: OwnerShellRunInput): Promise<OwnerShellRunResult> {
    if (!this.adminEnabled) {
      throw new PolicyError("Owner Runtime shell requires an Admin authority lease.");
    }
    if (!this.config.enabled) throw new OwnerRuntimeDisabledError();

    const scriptBytes = Buffer.byteLength(input.script, "utf8");
    if (scriptBytes === 0 || input.script.includes("\u0000")) {
      throw new PolicyError("Owner shell script is invalid.");
    }
    if (scriptBytes > this.config.maxScriptBytes) {
      throw new LimitError("Owner shell script exceeded configured byte limit.", {
        limit: this.config.maxScriptBytes,
      });
    }
    if (input.timeoutMs !== undefined && input.timeoutMs !== null && (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0)) {
      throw new PolicyError("Owner shell timeout must be a positive integer when provided.");
    }
    // Sınırsız veya bütçe üstü istek sessizce kırpılmaz; uzun iş için asenkron
    // yol açıkça önerilir.
    const budgetMs = this.config.maxTimeoutMs;
    if (input.timeoutMs === null || (input.timeoutMs !== undefined && input.timeoutMs > budgetMs)) {
      throw new HostedResponseBudgetError(input.timeoutMs ?? null, budgetMs);
    }
    const timeoutMs = input.timeoutMs ?? budgetMs;

    const cwd = await this.policy.resolve(input.cwd ?? ".");
    const scriptSha256 = createHash("sha256").update(input.script).digest("hex");
    return this.audit.run(
      "shell.run",
      this.policy.display(cwd),
      () => this.supervisor.run({
        shellPath: this.config.shellPath,
        script: input.script,
        cwd,
        timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
      {
        scriptByteCount: scriptBytes,
        scriptSha256,
      },
    );
  }
}
