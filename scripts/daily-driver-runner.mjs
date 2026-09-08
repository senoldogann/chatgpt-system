#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KEYCHAIN_SERVICE = "chatgpt-system-control-plane";
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!["--tunnel-client", "--profile", "--log-dir"].includes(arg)) {
      throw new Error(`Unknown daily-driver runner option: ${arg}`);
    }
    const value = takeValue(argv, index, arg);
    index += 1;
    if (arg === "--tunnel-client") tunnelClientPath = value;
    if (arg === "--profile") profile = value;
    if (arg === "--log-dir") logDir = value;
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

  return {
    tunnelClientPath: path.normalize(tunnelClientPath),
    profile,
    logDir: path.normalize(logDir),
  };
}

export function readControlPlaneKey(options = {}) {
  const spawnSyncImpl = options.spawnSync ?? spawnSync;
  const command = "/usr/bin/security";
  const args = [
    "find-generic-password",
    "-w",
    "-a", KEYCHAIN_ACCOUNT,
    "-s", KEYCHAIN_SERVICE,
  ];
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

export async function appendBoundedLog(file, chunk, maxBytes = MAX_LOG_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error("maxBytes must be a positive integer.");
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });

  let previous = Buffer.alloc(0);
  try {
    previous = await readFile(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const combined = Buffer.concat([previous, incoming]);
  const retained = combined.byteLength > maxBytes
    ? combined.subarray(combined.byteLength - maxBytes)
    : combined;
  await writeFile(file, retained, { mode: 0o600 });
}

export async function runDailyDriver(options = {}) {
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const readKey = options.readKey ?? (() => readControlPlaneKey());
  const spawnProcess = options.spawnProcess ?? spawn;
  const installSignalHandlers = options.installSignalHandlers ?? true;
  const config = parseRunnerArgs(argv);

  await mkdir(config.logDir, { recursive: true, mode: 0o700 });
  const controlPlaneKey = readKey();
  const child = spawnProcess(
    config.tunnelClientPath,
    ["run", "--profile", config.profile],
    {
      shell: false,
      env: { ...environment, CONTROL_PLANE_API_KEY: controlPlaneKey },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdoutPath = path.join(config.logDir, "stdout.log");
  const stderrPath = path.join(config.logDir, "stderr.log");
  let stdoutWrites = Promise.resolve();
  let stderrWrites = Promise.resolve();

  child.stdout?.on("data", (chunk) => {
    stdoutWrites = stdoutWrites.then(() => appendBoundedLog(stdoutPath, chunk));
  });
  child.stderr?.on("data", (chunk) => {
    stderrWrites = stderrWrites.then(() => appendBoundedLog(stderrPath, chunk));
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
