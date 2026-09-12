import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { defaultExistingChromeUserDataDir } from "./existing-chrome-discovery.js";

export const COMPUTER_MAX_JS_SOURCE_BYTES = 262_144;
export const COMPUTER_MAX_JS_RUNTIME_MS = 30_000;
export const COMPUTER_MAX_JS_OUTPUT_BYTES = 1_048_576;
export const CONTINUITY_MAX_RESUME_CHARS = 12_000;
export const CONTINUITY_MAX_TRACKED_PATHS = 100;
export const CONTINUITY_REMOTE_TIMEOUT_MS = 10_000;
export const OWNER_SHELL_MAX_SCRIPT_BYTES = 262_144;

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

export type BrowserConnectionMode = "managed" | "existing-chrome";

export interface BrowserConfig {
  enabled: boolean;
  connectionMode: BrowserConnectionMode;
  headless: boolean;
  timeoutMs: number;
  userDataDir: string;
  existingChromeUserDataDir: string | null;
}

export interface ContinuityConfig {
  databasePath: string;
  maxResumeChars: number;
  maxTrackedPaths: number;
  remoteVerificationTimeoutMs: number;
}

export interface OwnerRuntimeConfig {
  enabled: boolean;
  shellPath: string;
  maxScriptBytes: number;
}

export interface ComputerUseConfig {
  enabled: boolean;
  fullHostJsEnabled: boolean;
  hostBundlePath: string;
  requestTimeoutMs: number;
  maxObservationElements: number;
  maxObservationChars: number;
  maxScreenshotBytes: number;
  maxActionProgramActions: number;
  maxActionProgramRuntimeMs: number;
  maxAutomaticRetriesPerAction: number;
  maxJsSourceBytes: number;
  maxJsRuntimeMs: number;
  maxJsOutputBytes: number;
}

export interface AppConfig {
  roots: string[];
  auditFile: string;
  terminal: {
    enabled: boolean;
    commands: string[];
  };
  projectExec: {
    enabled: boolean;
  };
  personalAdmin: {
    enabled: boolean;
  };
  ownerRuntime: OwnerRuntimeConfig;
  computerUse: ComputerUseConfig;
  continuity: ContinuityConfig;
  browser: BrowserConfig;
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
  projectExecEnabled?: boolean;
  personalAdminEnabled?: boolean;
  ownerRuntimeEnabled?: boolean;
  ownerShellPath?: string;
  computerUseEnabled?: boolean;
  fullHostJsEnabled?: boolean;
  continuityDatabasePath?: string;
  commands?: string[];
  browserEnabled?: boolean;
  browserHeadless?: boolean;
  browserTimeoutMs?: number;
  browserUserDataDir?: string;
  browserExistingChrome?: boolean;
  browserExistingChromeUserDataDir?: string;
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
  CHATGPT_SYSTEM_ENABLE_PROJECT_EXEC: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_PERSONAL_ADMIN: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_OWNER_SHELL_PATH: z.string().optional(),
  CHATGPT_SYSTEM_ENABLE_COMPUTER_USE: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_ENABLE_FULL_HOST_JS: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_CONTINUITY_DATABASE: z.string().optional(),
  CHATGPT_SYSTEM_COMPUTER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_OBSERVATION_ELEMENTS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_OBSERVATION_CHARS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_SCREENSHOT_BYTES: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_ACTION_PROGRAM_ACTIONS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_ACTION_PROGRAM_RUNTIME_MS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_AUTOMATIC_RETRIES_PER_ACTION: z.coerce.number().int().min(0).max(2).optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES: z.coerce.number().int().positive().max(COMPUTER_MAX_JS_SOURCE_BYTES).optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS: z.coerce.number().int().positive().max(COMPUTER_MAX_JS_RUNTIME_MS).optional(),
  CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES: z.coerce.number().int().positive().max(COMPUTER_MAX_JS_OUTPUT_BYTES).optional(),
  CHATGPT_SYSTEM_ALLOW_COMMANDS: z.string().optional(),
  CHATGPT_SYSTEM_ENABLE_BROWSER: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_BROWSER_HEADLESS: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_BROWSER_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CHATGPT_SYSTEM_BROWSER_USER_DATA_DIR: z.string().optional(),
  CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME: z.enum(["true", "false", "1", "0"]).optional(),
  CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME_USER_DATA_DIR: z.string().optional(),
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

function resolveHomePath(requested: string, homeDir: string, label: string): string {
  let expanded = requested;
  if (requested === "~") expanded = homeDir;
  else if (requested.startsWith("~/")) expanded = path.join(homeDir, requested.slice(2));

  if (!path.isAbsolute(expanded)) {
    throw new Error(`${label} must be absolute or start with '~/'.`);
  }
  return path.normalize(expanded);
}

export function resolveControlSocketPath(value?: string, homeDir = homedir()): string {
  const requested = value ?? path.join(homeDir, ".chatgpt-system", "control.sock");
  return resolveHomePath(requested, homeDir, "Control socket path");
}

export function resolveBrowserUserDataDir(value?: string, homeDir = homedir()): string {
  const requested = value ?? path.join(homeDir, ".chatgpt-system", "browser-profile");
  return resolveHomePath(requested, homeDir, "Browser user-data directory");
}

export function defaultOwnerShellPath(current: NodeJS.Platform = process.platform): string {
  return current === "darwin" ? "/bin/zsh" : "/bin/sh";
}

export function resolveContinuityDatabasePath(value: string | undefined, homeDir: string): string {
  const requested = value ?? path.join(homeDir, ".chatgpt-system", "continuity", "continuity.db");
  return resolveHomePath(requested, homeDir, "Continuity database path");
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
  const browserUserDataDir = resolveBrowserUserDataDir(
    overrides.browserUserDataDir ?? env.CHATGPT_SYSTEM_BROWSER_USER_DATA_DIR,
    homeDir,
  );
  const browserEnabled = overrides.browserEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_BROWSER);
  const browserHeadless = overrides.browserHeadless ?? enabled(env.CHATGPT_SYSTEM_BROWSER_HEADLESS);
  const browserExistingChrome = overrides.browserExistingChrome ?? enabled(env.CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME);
  const browserExistingChromeUserDataDirInput =
    overrides.browserExistingChromeUserDataDir ?? env.CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME_USER_DATA_DIR;

  if (browserExistingChrome && !browserEnabled) {
    throw new Error("Existing Chrome mode requires --enable-browser.");
  }
  if (browserExistingChrome && browserHeadless) {
    throw new Error("Existing Chrome mode cannot be combined with browser headless mode.");
  }
  if (browserExistingChromeUserDataDirInput !== undefined && !browserExistingChrome) {
    throw new Error("Existing Chrome user-data directory requires --browser-existing-chrome.");
  }

  const browserConnectionMode: BrowserConnectionMode = browserExistingChrome ? "existing-chrome" : "managed";
  const existingChromeUserDataDir = browserConnectionMode === "existing-chrome"
    ? resolveHomePath(
        browserExistingChromeUserDataDirInput
          ?? defaultExistingChromeUserDataDir(process.platform, homeDir, process.env.LOCALAPPDATA),
        homeDir,
        "Existing Chrome user-data directory",
      )
    : null;

  const continuityDatabasePath = resolveContinuityDatabasePath(
    overrides.continuityDatabasePath ?? env.CHATGPT_SYSTEM_CONTINUITY_DATABASE,
    homeDir,
  );
  const personalAdminEnabled = overrides.personalAdminEnabled ?? enabled(env.CHATGPT_SYSTEM_PERSONAL_ADMIN);
  const ownerRuntimeEnabled = overrides.ownerRuntimeEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME);
  const ownerShellPathInput = overrides.ownerShellPath
    ?? env.CHATGPT_SYSTEM_OWNER_SHELL_PATH
    ?? defaultOwnerShellPath();
  let ownerShellPath = ownerShellPathInput;
  if (ownerRuntimeEnabled) {
    if (!path.isAbsolute(ownerShellPathInput)) {
      throw new Error("Owner shell path must be absolute.");
    }
    ownerShellPath = await realpath(ownerShellPathInput);
  }

  const config: AppConfig = {
    roots,
    auditFile: path.resolve(
      overrides.auditFile ?? env.CHATGPT_SYSTEM_AUDIT_FILE ?? path.join(homeDir, ".chatgpt-system", "audit.jsonl"),
    ),
    terminal: {
      enabled: overrides.terminalEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_TERMINAL),
      commands: [...new Set(overrides.commands ?? splitCsv(env.CHATGPT_SYSTEM_ALLOW_COMMANDS) ?? DEFAULT_COMMANDS)],
    },
    projectExec: {
      enabled: overrides.projectExecEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_PROJECT_EXEC),
    },
    personalAdmin: {
      enabled: personalAdminEnabled,
    },
    ownerRuntime: {
      enabled: ownerRuntimeEnabled,
      shellPath: ownerShellPath,
      maxScriptBytes: OWNER_SHELL_MAX_SCRIPT_BYTES,
    },
    computerUse: {
      enabled: overrides.computerUseEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_COMPUTER_USE),
      fullHostJsEnabled: overrides.fullHostJsEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_FULL_HOST_JS),
      hostBundlePath: path.join(homeDir, ".chatgpt-system", "ChatGPTSystemComputerRuntime.app"),
      requestTimeoutMs: env.CHATGPT_SYSTEM_COMPUTER_REQUEST_TIMEOUT_MS ?? 10_000,
      maxObservationElements: env.CHATGPT_SYSTEM_COMPUTER_MAX_OBSERVATION_ELEMENTS ?? 500,
      maxObservationChars: env.CHATGPT_SYSTEM_COMPUTER_MAX_OBSERVATION_CHARS ?? 262_144,
      maxScreenshotBytes: env.CHATGPT_SYSTEM_COMPUTER_MAX_SCREENSHOT_BYTES ?? 8_388_608,
      maxActionProgramActions: env.CHATGPT_SYSTEM_COMPUTER_MAX_ACTION_PROGRAM_ACTIONS ?? 100,
      maxActionProgramRuntimeMs: env.CHATGPT_SYSTEM_COMPUTER_MAX_ACTION_PROGRAM_RUNTIME_MS ?? 30_000,
      maxAutomaticRetriesPerAction: env.CHATGPT_SYSTEM_COMPUTER_MAX_AUTOMATIC_RETRIES_PER_ACTION ?? 2,
      maxJsSourceBytes: env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_SOURCE_BYTES ?? COMPUTER_MAX_JS_SOURCE_BYTES,
      maxJsRuntimeMs: env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_RUNTIME_MS ?? COMPUTER_MAX_JS_RUNTIME_MS,
      maxJsOutputBytes: env.CHATGPT_SYSTEM_COMPUTER_MAX_JS_OUTPUT_BYTES ?? COMPUTER_MAX_JS_OUTPUT_BYTES,
    },
    continuity: {
      databasePath: continuityDatabasePath,
      maxResumeChars: CONTINUITY_MAX_RESUME_CHARS,
      maxTrackedPaths: CONTINUITY_MAX_TRACKED_PATHS,
      remoteVerificationTimeoutMs: CONTINUITY_REMOTE_TIMEOUT_MS,
    },
    browser: {
      enabled: browserEnabled,
      connectionMode: browserConnectionMode,
      headless: browserHeadless,
      timeoutMs: overrides.browserTimeoutMs ?? env.CHATGPT_SYSTEM_BROWSER_TIMEOUT_MS ?? 10_000,
      userDataDir: browserUserDataDir,
      existingChromeUserDataDir,
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

  if (config.ownerRuntime.enabled && !config.personalAdmin.enabled) {
    throw new Error("Owner Runtime requires Personal Admin to be explicitly enabled.");
  }

  if (config.computerUse.fullHostJsEnabled && !config.computerUse.enabled) {
    throw new Error("Full-host JavaScript requires Computer Runtime to be explicitly enabled.");
  }

  return config;
}
