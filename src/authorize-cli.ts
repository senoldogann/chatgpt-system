import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { AppError } from "./errors.js";
import {
  CONTROL_PROTOCOL_VERSION,
  type ControlRequest,
  type ControlResponse,
} from "./control-protocol.js";
import {
  requestControl as defaultRequestControl,
  type ControlClientOptions,
} from "./control-client.js";

export interface AuthorizeArgs {
  profile: "user" | "admin";
  requestedTtlSeconds?: number;
  printLease: boolean;
}

export interface ClipboardChild {
  stdin: Writable | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null) => void): this;
}

export interface ClipboardSpawnOptions {
  shell: false;
  stdio: ["pipe", "ignore", "ignore"];
  env: NodeJS.ProcessEnv;
}

export type ClipboardSpawn = (
  executable: string,
  args: readonly string[],
  options: ClipboardSpawnOptions,
) => ClipboardChild;

export type ControlRequester = (
  request: ControlRequest,
  options: ControlClientOptions,
) => Promise<ControlResponse>;

export interface AuthorizeCommandDependencies {
  socketPath: string;
  requestControl?: ControlRequester;
  copyLease?: (value: string) => Promise<void>;
  writeStdout?: (value: string) => void;
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseAuthorizeArgs(argv: string[]): AuthorizeArgs {
  const profile = argv[0];
  if (profile !== "user" && profile !== "admin") {
    throw new Error("authorize requires profile user or admin.");
  }

  const parsed: AuthorizeArgs = { profile, printLease: false };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--print-lease") {
      if (parsed.printLease) throw new Error("--print-lease may be specified only once.");
      parsed.printLease = true;
      continue;
    }
    if (arg === "--ttl") {
      if (parsed.requestedTtlSeconds !== undefined) throw new Error("--ttl may be specified only once.");
      const raw = takeValue(argv, index, arg);
      const ttl = Number(raw);
      if (!Number.isInteger(ttl) || ttl <= 0) throw new Error("--ttl must be a positive integer.");
      parsed.requestedTtlSeconds = ttl;
      index += 1;
      continue;
    }
    throw new Error(`Unknown authorize argument: ${arg}`);
  }

  return parsed;
}

const defaultClipboardSpawn: ClipboardSpawn = (executable, args, options) => (
  spawn(executable, [...args], options) as unknown as ClipboardChild
);

export async function copyLeaseToClipboard(
  value: string,
  spawnProcess: ClipboardSpawn = defaultClipboardSpawn,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawnProcess("/usr/bin/pbcopy", [], {
      shell: false,
      stdio: ["pipe", "ignore", "ignore"],
      env: { PATH: "/usr/bin:/bin" },
    });

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    child.once("error", () => finishError(new Error("Failed to copy the authority lease to the clipboard.")));
    child.once("close", (code) => {
      if (code === 0) finishSuccess();
      else finishError(new Error("Failed to copy the authority lease to the clipboard."));
    });

    if (!child.stdin) {
      finishError(new Error("Failed to open the clipboard input stream."));
      return;
    }
    child.stdin.end(value, "utf8");
  });
}

export async function runAuthorizeCommand(
  args: AuthorizeArgs,
  dependencies: AuthorizeCommandDependencies,
): Promise<void> {
  const requestControl = dependencies.requestControl ?? defaultRequestControl;
  const copyLease = dependencies.copyLease ?? copyLeaseToClipboard;
  const writeStdout = dependencies.writeStdout ?? ((value: string) => process.stdout.write(value));

  const response = await requestControl({
    version: CONTROL_PROTOCOL_VERSION,
    action: "authorize",
    profile: args.profile,
    ...(args.requestedTtlSeconds !== undefined
      ? { requestedTtlSeconds: args.requestedTtlSeconds }
      : {}),
  }, { socketPath: dependencies.socketPath });

  if (!response.ok) {
    throw new AppError(response.message, response.error);
  }
  if (!("lease" in response)) {
    throw new AppError("The local authority control server did not return a lease.", "CONTROL_PROTOCOL_INVALID");
  }

  const lease = response.lease;
  if (args.printLease) {
    writeStdout(`${lease.leaseId}\n`);
    return;
  }

  await copyLease(lease.leaseId);
  const displayProfile = lease.profile === "user" ? "User" : "Admin";
  writeStdout(`${displayProfile} authority approved.\n`);
  writeStdout(`Expires: ${lease.expiresAt}\n`);
  writeStdout(`Terminal: ${lease.terminalEnabled ? "enabled" : "disabled"}\n`);
  writeStdout("Lease copied to clipboard.\n");
}
