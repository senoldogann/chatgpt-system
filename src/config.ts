import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { defaultExistingChromeUserDataDir } from "./existing-chrome-discovery.js";

export const COMPUTER_MAX_JS_SOURCE_BYTES = 262_144;
export const COMPUTER_MAX_JS_RUNTIME_MS = 30_000;
export const COMPUTER_MAX_JS_OUTPUT_BYTES = 1_048_576;
export const COMPUTER_MAX_RUN_STEP_RESULTS = 256;
export const COMPUTER_MAX_EXPLICIT_RUNTIME_MS = 2_147_483_647;
export const CONTINUITY_MAX_RESUME_CHARS = 12_000;
export const CONTINUITY_MAX_TRACKED_PATHS = 100;
export const CONTINUITY_REMOTE_TIMEOUT_MS = 10_000;
export const OWNER_SHELL_MAX_SCRIPT_BYTES = 262_144;
export const OWNER_WORKSTATION_COMMAND_TIMEOUT_MS = 120_000;
// Hosted ChatGPT dispatcher, yanıtı beklemediği komutu düşürür ve model aynı işi
// yeniden dener. Tek bir tool çağrısı bu bütçeyi asla aşmamalıdır.
export const HOSTED_RESPONSE_BUDGET_MS = 120_000;
export const OWNER_TERMINAL_MAX_SESSIONS = 32;
export const OWNER_TERMINAL_MAX_OUTPUT_BYTES = 262_144;
export const OWNER_TERMINAL_MAX_INPUT_BYTES = 65_536;

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
  maxTimeoutMs: number;
  maxTerminalSessions: number;
  maxTerminalOutputBytes: number;
  maxTerminalInputBytes: number;
}

export interface JevTargetingConfig {
  enabled: boolean;
  apiKey: string | null;
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
  jevTargeting: JevTargetingConfig;
  continuity: ContinuityConfig;
  sessionEvents: {
    enabled: boolean;
  };
  browser: BrowserConfig;
  control: {
    enabled: boolean;
    socketPath: string;
  };
  http: {
    host: string;
    port: number;
    allowNonLoopback: boolean;
    token?: string;
  };
  limits: LimitsConfig;
}

export interface ConfigOverrides {
  roots?: string[];
  auditFile?: string;
  terminalEnabled?: boolean;
  ownerWorkstationEnabled?: boolean;
  commandTimeoutMs?: number;
  projectExecEnabled?: boolean;
  personalAdminEnabled?: boolean;
  ownerRuntimeEnabled?: boolean;
  ownerShellPath?: string;
  computerUseEnabled?: boolean;
  fullHostJsEnabled?: boolean;
  jevTargetingEnabled?: boolean;
  typesafeApiKey?: string;
  continuityDatabasePath?: string;
  sessionEventsEnabled?: boolean;
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
  allowNonLoopbackHttp?: boolean;
}

export function applyOwnerWorkstationPreset(overrides: ConfigOverrides): ConfigOverrides {
  if (overrides.ownerWorkstationEnabled !== true) return { ...overrides };
  return {
    ...overrides,
    ownerWorkstationEnabled: true,
    personalAdminEnabled: true,
    ownerRuntimeEnabled: true,
    terminalEnabled: true,
    projectExecEnabled: true,
    computerUseEnabled: true,
    fullHostJsEnabled: true,
    commandTimeoutMs: overrides.commandTimeoutMs ?? OWNER_WORKSTATION_COMMAND_TIMEOUT_MS,
  };
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
  CHATGPT_SYSTEM_ENABLE_JEV_TARGETING: z.enum(["true", "false", "1", "0"]).optional(),
  TYPESAFE_API_KEY: z.string().min(1).optional(),
  CHATGPT_SYSTEM_CONTINUITY_DATABASE: z.string().optional(),
  CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS: z.enum(["true", "false", "1", "0"]).optional(),
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
  CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP: z.enum(["true", "false", "1", "0"]).optional(),
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
  CHATGPT_SYSTEM_HOSTED_RESPONSE_BUDGET_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
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

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
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
  const effectiveOverrides = applyOwnerWorkstationPreset(overrides);
  const env = EnvSchema.parse(process.env);
  const requestedRoots = effectiveOverrides.roots ?? splitRoots(env.CHATGPT_SYSTEM_ROOTS) ?? [process.cwd()];
  const canonicalRoots = await Promise.all(requestedRoots.map(async (root) => realpath(path.resolve(root))));
  const roots = [...new Set(canonicalRoots)];

  if (roots.length === 0) throw new Error("At least one filesystem root is required.");

  const token = effectiveOverrides.token ?? env.CHATGPT_SYSTEM_HTTP_TOKEN;
  const httpHost = effectiveOverrides.host ?? env.CHATGPT_SYSTEM_HTTP_HOST ?? "127.0.0.1";
  const allowNonLoopbackHttp = effectiveOverrides.allowNonLoopbackHttp
    ?? enabled(env.CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP);
  if (!isLoopbackHost(httpHost) && !allowNonLoopbackHttp) {
    throw new Error("Non-loopback HTTP bind requires --allow-non-loopback-http or CHATGPT_SYSTEM_ALLOW_NON_LOOPBACK_HTTP=true.");
  }
  const http = {
    host: httpHost,
    port: effectiveOverrides.port ?? env.CHATGPT_SYSTEM_HTTP_PORT ?? 4312,
    allowNonLoopback: allowNonLoopbackHttp,
    ...(token ? { token } : {}),
  };
  const homeDir = homedir();
  const controlSocketPath = resolveControlSocketPath(
    effectiveOverrides.controlSocketPath ?? env.CHATGPT_SYSTEM_CONTROL_SOCKET,
    homeDir,
  );
  const browserUserDataDir = resolveBrowserUserDataDir(
    effectiveOverrides.browserUserDataDir ?? env.CHATGPT_SYSTEM_BROWSER_USER_DATA_DIR,
    homeDir,
  );
  const browserEnabled = effectiveOverrides.browserEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_BROWSER);
  const browserHeadless = effectiveOverrides.browserHeadless ?? enabled(env.CHATGPT_SYSTEM_BROWSER_HEADLESS);
  const browserExistingChrome = effectiveOverrides.browserExistingChrome ?? enabled(env.CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME);
  const browserExistingChromeUserDataDirInput =
    effectiveOverrides.browserExistingChromeUserDataDir ?? env.CHATGPT_SYSTEM_BROWSER_EXISTING_CHROME_USER_DATA_DIR;

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
    effectiveOverrides.continuityDatabasePath ?? env.CHATGPT_SYSTEM_CONTINUITY_DATABASE,
    homeDir,
  );
  const personalAdminEnabled = effectiveOverrides.personalAdminEnabled ?? enabled(env.CHATGPT_SYSTEM_PERSONAL_ADMIN);
  const ownerRuntimeEnabled = effectiveOverrides.ownerRuntimeEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_OWNER_RUNTIME);
  const ownerShellPathInput = effectiveOverrides.ownerShellPath
    ?? env.CHATGPT_SYSTEM_OWNER_SHELL_PATH
    ?? defaultOwnerShellPath();
  let ownerShellPath = ownerShellPathInput;
  if (ownerRuntimeEnabled) {
    if (!path.isAbsolute(ownerShellPathInput)) {
      throw new Error("Owner shell path must be absolute.");
    }
    ownerShellPath = await realpath(ownerShellPathInput);
  }

  const jevTargetingEnabled = effectiveOverrides.jevTargetingEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_JEV_TARGETING);

  const config: AppConfig = {
    roots,
    auditFile: path.resolve(
      effectiveOverrides.auditFile ?? env.CHATGPT_SYSTEM_AUDIT_FILE ?? path.join(homeDir, ".chatgpt-system", "audit.jsonl"),
    ),
    terminal: {
      enabled: effectiveOverrides.terminalEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_TERMINAL),
      commands: [...new Set(effectiveOverrides.commands ?? splitCsv(env.CHATGPT_SYSTEM_ALLOW_COMMANDS) ?? DEFAULT_COMMANDS)],
    },
    projectExec: {
      enabled: effectiveOverrides.projectExecEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_PROJECT_EXEC),
    },
    personalAdmin: {
      enabled: personalAdminEnabled,
    },
    ownerRuntime: {
      enabled: ownerRuntimeEnabled,
      shellPath: ownerShellPath,
      maxScriptBytes: OWNER_SHELL_MAX_SCRIPT_BYTES,
      maxTimeoutMs: env.CHATGPT_SYSTEM_HOSTED_RESPONSE_BUDGET_MS ?? HOSTED_RESPONSE_BUDGET_MS,
      maxTerminalSessions: OWNER_TERMINAL_MAX_SESSIONS,
      maxTerminalOutputBytes: OWNER_TERMINAL_MAX_OUTPUT_BYTES,
      maxTerminalInputBytes: OWNER_TERMINAL_MAX_INPUT_BYTES,
    },
    computerUse: {
      enabled: effectiveOverrides.computerUseEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_COMPUTER_USE),
      fullHostJsEnabled: effectiveOverrides.fullHostJsEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_FULL_HOST_JS),
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
    jevTargeting: {
      enabled: jevTargetingEnabled,
      apiKey: effectiveOverrides.typesafeApiKey ?? env.TYPESAFE_API_KEY ?? null,
    },
    continuity: {
      databasePath: continuityDatabasePath,
      maxResumeChars: CONTINUITY_MAX_RESUME_CHARS,
      maxTrackedPaths: CONTINUITY_MAX_TRACKED_PATHS,
      remoteVerificationTimeoutMs: CONTINUITY_REMOTE_TIMEOUT_MS,
    },
    sessionEvents: {
      enabled: effectiveOverrides.sessionEventsEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_SESSION_EVENTS),
    },
    browser: {
      enabled: browserEnabled,
      connectionMode: browserConnectionMode,
      headless: browserHeadless,
      timeoutMs: effectiveOverrides.browserTimeoutMs ?? env.CHATGPT_SYSTEM_BROWSER_TIMEOUT_MS ?? 10_000,
      userDataDir: browserUserDataDir,
      existingChromeUserDataDir,
    },
    control: {
      enabled: effectiveOverrides.controlEnabled ?? enabled(env.CHATGPT_SYSTEM_ENABLE_CONTROL),
      socketPath: controlSocketPath,
    },
    http,
    limits: {
      maxReadBytes: env.CHATGPT_SYSTEM_MAX_READ_BYTES ?? 1_048_576,
      maxWriteBytes: env.CHATGPT_SYSTEM_MAX_WRITE_BYTES ?? 2_097_152,
      maxDirectoryEntries: env.CHATGPT_SYSTEM_MAX_DIRECTORY_ENTRIES ?? 2_000,
      maxCommandOutputBytes: env.CHATGPT_SYSTEM_MAX_COMMAND_OUTPUT_BYTES ?? 1_048_576,
      commandTimeoutMs: effectiveOverrides.commandTimeoutMs ?? env.CHATGPT_SYSTEM_COMMAND_TIMEOUT_MS ?? 60_000,
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

  if (config.jevTargeting.enabled && !config.computerUse.enabled) {
    throw new Error("Jev semantic targeting requires Computer Runtime to be explicitly enabled.");
  }
  if (config.jevTargeting.enabled && config.jevTargeting.apiKey === null) {
    throw new Error("Jev semantic targeting requires the TYPESAFE_API_KEY environment variable.");
  }

  return config;
}
