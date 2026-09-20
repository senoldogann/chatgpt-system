#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KEYCHAIN_SERVICE = "chatgpt-system-control-plane";
export const KEYCHAIN_SERVICE_TYPESAFE = "chatgpt-system-typesafe";
export const KEYCHAIN_ACCOUNT = "chatgpt-system";
export const MAX_LOG_BYTES = 1_048_576;

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseRunnerArgs(argv) {
  let tunnelClientPath;
  let profile;
  let logDir;
  let keychainHelperPath;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--tunnel-client", "--profile", "--log-dir", "--keychain-helper"].includes(arg)) {
      throw new Error(`Unknown daily-driver runner option: ${arg}`);
    }
    const value = takeValue(argv, index, arg);
    index += 1;
    if (arg === "--tunnel-client") tunnelClientPath = value;
    if (arg === "--profile") profile = value;
    if (arg === "--log-dir") logDir = value;
    if (arg === "--keychain-helper") keychainHelperPath = value;
  }

  if (!tunnelClientPath || !path.isAbsolute(tunnelClientPath)) {
    throw new Error("--tunnel-client must be an absolute executable path.");
  }
  if (!profile || !/^[A-Za-z0-9_-]+$/.test(profile)) {
    throw new Error("--profile may contain only letters, numbers, '-' and '_'.");
  }
  if (!logDir || !path.isAbsolute(logDir)) {
    throw new Error("--log-dir must be an absolute path.");
  }
  if (!keychainHelperPath || !path.isAbsolute(keychainHelperPath)) {
    throw new Error("--keychain-helper must be an absolute executable path.");
  }

  return {
    tunnelClientPath: path.normalize(tunnelClientPath),
    profile,
    logDir: path.normalize(logDir),
    keychainHelperPath: path.normalize(keychainHelperPath),
  };
}

export function readControlPlaneKey(options = {}) {
  const spawnSyncImpl = options.spawnSync ?? spawnSync;
  const helperPath = options.helperPath;
  if (!helperPath || !path.isAbsolute(helperPath)) {
    throw new Error("Keychain helper path must be absolute.");
  }
  const command = path.normalize(helperPath);
  const args = ["read", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE];
  const result = spawnSyncImpl(command, args, {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error("Unable to read the daily-driver tunnel credential from macOS Keychain.");
  }
  const key = String(result.stdout ?? "").replace(/\r?\n$/, "");
  if (!key) throw new Error("The daily-driver tunnel credential is empty.");
  return key;
}

export function readTypesafeApiKey(options = {}) {
  const spawnSyncImpl = options.spawnSync ?? spawnSync;
  const helperPath = options.helperPath;
  if (!helperPath || !path.isAbsolute(helperPath)) {
    throw new Error("Keychain helper path must be absolute.");
  }
  const command = path.normalize(helperPath);
  const args = ["read", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE_TYPESAFE];
  const result = spawnSyncImpl(command, args, {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const key = String(result.stdout ?? "").trim();
  return key || null;
}

// Rotation lock: keeps concurrent writers from reading stale sizes mid-truncate.
// The runner is single-process, but tests and tooling may call appendBoundedLog
// concurrently on the same file.
const logLocks = new Map();

function withLogLock(file, operation) {
  const previous = logLocks.get(file) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  logLocks.set(file, next);
  const release = () => {
    if (logLocks.get(file) === next) logLocks.delete(file);
  };
  next.then(release, release);
  return next;
}

// Bounded log strategy: appends are O(incoming); once the active file reaches
// half the bound it is rotated aside with a single rename and a fresh file keeps
// receiving the stream. Every file stays within the bound, the newest data is
// always in the active file, and the previous window remains available as
// "<file>.1" for bounded diagnostics.
export async function appendBoundedLog(file, chunk, maxBytes = MAX_LOG_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error("maxBytes must be a positive integer.");
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  return withLogLock(file, async () => {
    let currentSize = 0;
    try {
      currentSize = (await stat(file)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    if (incoming.byteLength >= maxBytes) {
      await writeFile(file, incoming.subarray(incoming.byteLength - maxBytes), { mode: 0o600 });
      return;
    }

    if (currentSize > 0 && currentSize + incoming.byteLength > maxBytes / 2) {
      await rename(file, `${file}.1`);
      currentSize = 0;
    }

    const handle = await open(file, "a", 0o600);
    try {
      await handle.writeFile(incoming);
    } finally {
      await handle.close();
    }
  });
}

export async function runDailyDriver(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const spawnProcess = options.spawnProcess ?? spawn;
  const installSignalHandlers = options.installSignalHandlers ?? true;
  const appendLog = options.appendLog ?? appendBoundedLog;
  const config = parseRunnerArgs(argv);
  const readKey = options.readKey ?? (() => readControlPlaneKey({ helperPath: config.keychainHelperPath }));
  const readTypesafeKey = options.readTypesafeKey ?? (() => readTypesafeApiKey({ helperPath: config.keychainHelperPath }));

  await mkdir(config.logDir, { recursive: true, mode: 0o700 });
  const controlPlaneKey = readKey();
  const typesafeKey = environment.TYPESAFE_API_KEY || readTypesafeKey();
  const child = spawnProcess(
    config.tunnelClientPath,
    ["run", "--profile", config.profile],
    {
      shell: false,
      env: {
        ...environment,
        CONTROL_PLANE_API_KEY: controlPlaneKey,
        ...(typesafeKey ? { TYPESAFE_API_KEY: typesafeKey } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdoutPath = path.join(config.logDir, "stdout.log");
  const stderrPath = path.join(config.logDir, "stderr.log");
  let stdoutWrites = Promise.resolve();
  let stderrWrites = Promise.resolve();
  let logWriteFailure;
  const trackWrite = (queue, chunk, file) => queue.then(
    () => appendLog(file, chunk),
    () => appendLog(file, chunk),
  ).catch((error) => {
    // Keep draining so one failed write cannot grow the queue unboundedly, and
    // surface the first failure: losing tunnel diagnostics silently is worse
    // than a loud runner restart under launchd KeepAlive.
    logWriteFailure ??= error;
  });

  child.stdout?.on("data", (chunk) => {
    stdoutWrites = trackWrite(stdoutWrites, chunk, stdoutPath);
  });
  child.stderr?.on("data", (chunk) => {
    stderrWrites = trackWrite(stderrWrites, chunk, stderrPath);
  });

  const forwardSignal = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // launchd will restart the wrapper if the child has already disappeared.
    }
  };

  if (installSignalHandlers) {
    process.once("SIGTERM", forwardSignal);
    process.once("SIGINT", forwardSignal);
  }

  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    await Promise.all([stdoutWrites, stderrWrites]);
    if (logWriteFailure) throw logWriteFailure;
    return exitCode;
  } finally {
    if (installSignalHandlers) {
      process.off("SIGTERM", forwardSignal);
      process.off("SIGINT", forwardSignal);
    }
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runDailyDriver()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`[chatgpt-system] daily-driver runner failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
