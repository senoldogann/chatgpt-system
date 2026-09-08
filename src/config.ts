import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

export interface LimitsConfig {
  maxReadBytes: number;
  maxWriteBytes: number;
  maxDirectoryEntries: number;
  maxCommandOutputBytes: number;
  commandTimeoutMs: number;
  maxManagedProcesses: number;
  maxProcessLogBytesPerStream: number;
  processStopGraceMs: number;
}

export interface AppConfig {
  roots: string[];
  auditFile: string;
  terminal: {
    enabled: boolean;
    commands: string[];
  };
  personalAdmin: {
    enabled: boolean;
  };
  control: {
    enabled: boolean;
    socketPath: string;
  };
  http: {
    host: string;
    port: number;
    token?: string;
  };
  limits: LimitsConfig;
}

export interface ConfigOverrides {
  roots?: string[];
  auditFile?: string;
  terminalEnabled?: boolean;
  personalAdminEnabled?: boolean;
  commands?: string[];
  controlEnabled?: boolean;
  controlSocketPath?: string;
  host?: string;
  port?: number;
  token?: string;
}

const EnvSchema = z.object({
  CHATGPT_SYSTEM_ROOTS: z.string().optional(),
  CHATGPT_SYSTEM_AUDIT_FILE: z.string().optional(),
  CHATGPT_SYSTEM_ENABLE_TERMINAL: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_PERSONAL_ADMIN: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_ALLOW_COMMANDS: z.string().optional(),
  CHATGPT_SYSTEM_ENABLE_CONTROL: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_CONTROL_SOCKET: z.string().optional(),
  CHATGPT_SYSTEM_HTTP_HOST: z.string().optional(),
  CHATGPT_SYSTEM_HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  CHATGPT_SYSTEM_HTTP_TOKEN: z.string().min(16).optional(),
  CHATGPT_SYSTEM_MAX_READ_BYTES: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_MAX_WRITE_BYTES: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_MAX_DIRECTORY_ENTRIES: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_MAX_COMMAND_OUTPUT_BYTES: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS: z.coerce.number().int().positive().optional(),
});

export const DEFAULT_COMMANDS = [
  "git",
  "node",
  "npm",
  "npx",
  "pnpm",
  "bun",
  "deno",
  "python3",
  "go",
  "cargo",
  "swift",
  "swiftc",
  "xcodebuild",
  "make",
  "cmake",
] as const;

function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function splitRoots(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function resolveControlSocketPath(value?: string, homeDir = homedir()): string {
  const requested = value ?? path.join(homeDir, ".chatgpt-system", "control.sock");
  let expanded = requested;
  if (requested === "~") expanded = homeDir;
  else if (requested.startsWith("~/")) expanded = path.join(homeDir, requested.slice(2));

  if (!path.isAbsolute(expanded)) {
    throw new Error("Control socket path must be absolute or start with '~/'.");
  }
  return path.normalize(expanded);
}

export async function loadConfig(overrides: ConfigOverrides = {}): Promise<AppConfig> {
  const env = EnvSchema.parse(process.env);
  const requestedRoots = overrides.roots ?? splitRoots(env.CHATGPT_SYSTEM_ROOTS) ?? [process.cwd()];
  const canonicalRoots = await Promise.all(requestedRoots.map(async (root) => realpath(path.resolve(root))));
  const roots = [...new Set(canonicalRoots)];

  if (roots.length === 0) throw new Error("At least one filesystem root is required.");

  const token = overrides.token ?? env.CHATGPT_SYSTEM_HTTP_TOKEN;
  const http = {
    host: overrides.host ?? env.CHATGPT_SYSTEM_HTTP_HOST ?? "127.0.0.1",
    port: overrides.port ?? env.CHATGPT_SYSTEM_HTTP_PORT ?? 4312,
    ...(token ? { token } : {}),
  };
  const homeDir = homedir();
  const controlSocketPath = resolveControlSocketPath(
    overrides.controlSocketPath ?? env.CHATGPT_SYSTEM_CONTROL_SOCKET,
    homeDir,
  );

  return {
    roots,
    auditFile: path.resolve(
      overrides.auditFile ?? env.CHATGPT_SYSTEM_AUDIT_FILE ?? path.join(homeDir, ".chatgpt-system", "audit.jsonl"),
    ),
    terminal: {
      enabled: overrides.terminalEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_TERMINAL),
      commands: [...new Set(overrides.commands ?? splitCsv(env.CHATGPT_SYSTEM_ALLOW_COMMANDS) ?? DEFAULT_COMMANDS)],
    },
    personalAdmin: {
      enabled: overrides.personalAdminEnabled ?? enabled(env.CHATGPT_SYSTEM_PERSONAL_ADMIN),
    },
    control: {
      enabled: overrides.controlEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_CONTROL),
      socketPath: controlSocketPath,
    },
    http,
    limits: {
      maxReadBytes: env.CHATGPT_SYSTEM_MAX_READ_BYTES ?? 1_048_576,
      maxWriteBytes: env.CHATGPT_SYSTEM_MAX_WRITE_BYTES ?? 2_097_152,
      maxDirectoryEntries: env.CHATGPT_SYSTEM_MAX_DIRECTORY_ENTRIES ?? 2_000,
      maxCommandOutputBytes: env.CHATGPT_SYSTEM_MAX_COMMAND_OUTPUT_BYTES ?? 1_048_576,
      commandTimeoutMs: env.CHATGPT_SYSTEM_COMMAND_TIMEOUT_MS ?? 60_000,
      maxManagedProcesses: env.CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES ?? 32,
      maxProcessLogBytesPerStream: env.CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM ?? 131_072,
      processStopGraceMs: env.CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS ?? 3_000,
    },
  };
}
