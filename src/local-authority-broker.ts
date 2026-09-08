import { spawn } from "node:child_process";
import { z } from "zod";
import {
  LocalApprovalInvalidError,
  LocalApprovalUnavailableError,
} from "./errors.js";
import type { AuthorityApprovalProfile } from "./authority-request-manager.js";
import {
  MACOS_AUTHORITY_HELPER_PATH,
  MacOSNativeHelperTrustValidator,
  type NativeHelperTrustValidator,
} from "./native-helper-trust.js";

export type LocalAuthorityOutcome = "authenticated" | "denied" | "cancelled" | "unavailable" | "failed";

export interface LocalAuthorityBrokerResult {
  requestId: string;
  profile: AuthorityApprovalProfile;
  approved: boolean;
  outcome: LocalAuthorityOutcome;
}

export interface LocalAuthorityBroker {
  request(input: { requestId: string; profile: AuthorityApprovalProfile }): Promise<LocalAuthorityBrokerResult>;
}

export interface BrokerProcessInvocation {
  executable: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface BrokerProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type BrokerProcessRunner = (invocation: BrokerProcessInvocation) => Promise<BrokerProcessResult>;

export interface MacOSLocalAuthorityBrokerOptions {
  platform?: NodeJS.Platform;
  runProcess?: BrokerProcessRunner;
  trustValidator?: NativeHelperTrustValidator;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const helperResponseSchema = z.object({
  requestId: z.string().min(1),
  profile: z.enum(["user", "admin"]),
  approved: z.boolean(),
  outcome: z.enum(["authenticated", "denied", "cancelled", "unavailable", "failed"]),
}).strict();

const SAFE_ENV_KEYS = ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "TMPDIR"] as const;

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function defaultRunProcess(invocation: BrokerProcessInvocation): Promise<BrokerProcessResult> {
  return new Promise<BrokerProcessResult>((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      shell: false,
      env: sanitizedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let outputLimited = false;
    let timedOut = false;

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > invocation.maxOutputBytes) {
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
    }, invocation.timeoutMs);
    timer.unref();

    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (outputLimited || timedOut) {
        reject(new Error(outputLimited ? "native helper output limit" : "native helper timeout"));
        return;
      }
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export class MacOSLocalAuthorityBroker implements LocalAuthorityBroker {
  private readonly platform: NodeJS.Platform;
  private readonly runProcess: BrokerProcessRunner;
  private readonly trustValidator: NativeHelperTrustValidator;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: MacOSLocalAuthorityBrokerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.runProcess = options.runProcess ?? defaultRunProcess;
    this.trustValidator = options.trustValidator ?? new MacOSNativeHelperTrustValidator();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 16 * 1024;
  }

  async request(input: { requestId: string; profile: AuthorityApprovalProfile }): Promise<LocalAuthorityBrokerResult> {
    if (this.platform !== "darwin") {
      throw new LocalApprovalUnavailableError("Local approval is only available through the protected macOS helper.");
    }

    try {
      await this.trustValidator.validate();
    } catch {
      throw new LocalApprovalUnavailableError(
        "The protected macOS local approval helper is unavailable or untrusted.",
      );
    }

    let processResult: BrokerProcessResult;
    try {
      processResult = await this.runProcess({
        executable: MACOS_AUTHORITY_HELPER_PATH,
        args: ["--profile", input.profile, "--request-id", input.requestId],
        timeoutMs: this.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
      });
    } catch {
      throw new LocalApprovalUnavailableError("The macOS local approval helper could not be executed.");
    }

    if (processResult.exitCode !== 0) {
      throw new LocalApprovalUnavailableError("The macOS local approval helper did not complete successfully.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(processResult.stdout.trim());
    } catch {
      throw new LocalApprovalInvalidError("The macOS local approval helper returned an invalid response.");
    }

    const validated = helperResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new LocalApprovalInvalidError("The macOS local approval helper returned an invalid response.");
    }

    const result = validated.data;
    if (result.requestId !== input.requestId || result.profile !== input.profile) {
      throw new LocalApprovalInvalidError("The macOS local approval response did not match the pending request.");
    }
    if (result.approved !== (result.outcome === "authenticated")) {
      throw new LocalApprovalInvalidError("The macOS local approval response was internally inconsistent.");
    }

    return result;
  }
}
