#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAILY_DRIVER_LABEL = "com.senoldogann.chatgpt-system.daily-driver";
const DEFAULT_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 120;
const MAX_LOG_BYTES = 1_048_576;

export function parseDiagnosticArgs(argv) {
  let windowMinutes = DEFAULT_WINDOW_MINUTES;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== "--minutes") throw new Error(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--minutes requires a value between 1 and 120.");
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_WINDOW_MINUTES) {
      throw new Error("--minutes must be an integer between 1 and 120.");
    }
    windowMinutes = parsed;
    index += 1;
  }
  return { windowMinutes };
}

export function summarizeTunnelLog(stdoutText, { nowMs = Date.now(), windowMs } = {}) {
  const effectiveWindowMs = Number.isFinite(windowMs) && windowMs >= 0
    ? windowMs
    : DEFAULT_WINDOW_MINUTES * 60_000;
  const cutoff = nowMs - effectiveWindowMs;
  let forwardedCommandCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let stdioFailureCount = 0;
  let recoveredPollBackoffCount = 0;
  let pendingPollBackoffCount = 0;
  let recentActivity = false;

  for (const line of String(stdoutText ?? "").split(/\r?\n/)) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record || typeof record !== "object") continue;
    const timeMs = Date.parse(typeof record.time === "string" ? record.time : "");
    if (!Number.isFinite(timeMs) || timeMs < cutoff || timeMs > nowMs + 60_000) continue;
    recentActivity = true;

    const level = typeof record.level === "string" ? record.level.toUpperCase() : "";
    const message = typeof record.msg === "string" ? record.msg : "";
    if (level === "WARN") warningCount += 1;
    if (level === "ERROR") errorCount += 1;
    if (message === "dispatcher forwarded command to MCP server") forwardedCommandCount += 1;
    if (/stdio MCP command failed|stdio MCP command stdout closed|unexpected EOF/i.test(message)) {
      stdioFailureCount += 1;
    }
    // A poll backoff that the poller itself recovers from is transient hosted-side
    // evidence, not a local failure that justifies restarting a healthy tunnel.
    if (level === "WARN" && /poll timed out; backing off/i.test(message)) pendingPollBackoffCount += 1;
    if (/poller recovered; polling operational/i.test(message)) {
      recoveredPollBackoffCount += pendingPollBackoffCount;
      pendingPollBackoffCount = 0;
    }
  }

  return {
    forwardedCommandCount,
    warningCount,
    errorCount,
    stdioFailureCount,
    recoveredPollBackoffCount,
    recentActivity,
  };
}

export function parseLaunchAgentStatus(text, exitCode) {
  if (exitCode !== 0) return { loaded: false, running: false, neverExited: null };
  const value = String(text ?? "");
  const running = /(?:^|\n)\s*state\s*=\s*running\s*(?:\n|$)/m.test(value);
  let neverExited = null;
  if (/last exit code\s*=\s*\(never exited\)/i.test(value)) neverExited = true;
  else if (/last exit code\s*=/i.test(value)) neverExited = false;
  return { loaded: true, running, neverExited };
}

function pathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function classifyRuntimeSource(commandPath, homeDir = homedir()) {
  if (!commandPath) return "unknown";
  const normalized = path.resolve(commandPath);
  const stableRoot = path.join(path.resolve(homeDir), ".chatgpt-system", "runtime");
  const worktreeRoot = path.join(path.resolve(homeDir), ".chatgpt-system", "worktrees");
  if (pathInside(normalized, stableRoot)) return "stable-runtime";
  if (pathInside(normalized, worktreeRoot)) return "managed-worktree";
  return "other";
}

export function classifyConnectionEvidence(evidence) {
  if (!evidence.dailyDriver.loaded || !evidence.dailyDriver.running) return "DAILY_DRIVER_UNAVAILABLE";

  if (
    evidence.runtime.distCliPresent === false
    || evidence.runtime.nodeModulesPresent === false
    || evidence.runtime.zodPresent === false
  ) {
    return "LOCAL_RUNTIME_DEPENDENCY_FAILURE";
  }
  if (
    evidence.tunnel.stdioFailureCount > 0
    || evidence.tunnel.errorCount > 0
    || evidence.tunnel.warningCount - evidence.tunnel.recoveredPollBackoffCount > 0
  ) {
    return "LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE";
  }
  if (evidence.tunnel.recentActivity && evidence.tunnel.forwardedCommandCount > 0) {
    return "LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE";
  }
  return "INSUFFICIENT_EVIDENCE";
}

function guidanceFor(diagnosis, runtimeSource) {
  const guidance = [];
  if (runtimeSource === "managed-worktree") {
    guidance.push("The active MCP runtime is sourced from a managed worktree. Do not remove that worktree until the tunnel/profile is repointed and a fresh diagnostic no longer reports it as active.");
  }

  if (diagnosis === "LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE") {
    guidance.push("No strong local failure evidence was found in the inspected window. Do not restart a healthy tunnel solely because ChatGPT Web reported a stream interruption or developer-MCP surface loss.");
    guidance.push("If the conversation cannot use developer MCPs, continue in a new supported standard text chat and resume the exact Project Continuity alias before local mutation.");
  } else if (diagnosis === "LOCAL_RUNTIME_DEPENDENCY_FAILURE") {
    guidance.push("Local runtime dependency evidence is unhealthy. Rebuild or repoint the configured runtime before removing any referenced worktree; do not hide the failure with a blind restart loop.");
  } else if (diagnosis === "LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE") {
    guidance.push("Recent local tunnel/MCP failure evidence exists. Inspect the bounded daily-driver state and fix the specific local cause before retrying the hosted workflow.");
  } else if (diagnosis === "DAILY_DRIVER_UNAVAILABLE") {
    guidance.push("The daily-driver is not loaded and running. Diagnose the local service before attributing the failure to ChatGPT Web.");
  } else {
    guidance.push("The inspected window does not contain enough evidence to classify the boundary. Capture the UI incident time and rerun diagnostics close to that timestamp.");
  }
  return guidance;
}

export function buildDiagnosticReport(evidence, windowMinutes) {
  const diagnosis = classifyConnectionEvidence(evidence);
  return {
    diagnosis,
    windowMinutes,
    dailyDriver: { ...evidence.dailyDriver },
    tunnel: { ...evidence.tunnel },
    runtime: { ...evidence.runtime },
    stderr: { ...evidence.stderr },
    guidance: guidanceFor(diagnosis, evidence.runtime.source),
  };
}

function readBoundedText(file, maxBytes = MAX_LOG_BYTES) {
  try {
    const data = readFileSync(file);
    const retained = data.byteLength > maxBytes ? data.subarray(data.byteLength - maxBytes) : data;
    return retained.toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function safeStat(file) {
  try {
    return statSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseProcessTable(text) {
  const processes = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    processes.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  return processes;
}

function isDescendant(process, ancestorPid, byPid) {
  const seen = new Set();
  let current = process;
  while (current && current.ppid > 0 && !seen.has(current.pid)) {
    if (current.ppid === ancestorPid) return true;
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}

function extractScriptPath(command, homeDir) {
  const homePrefix = `${path.resolve(homeDir)}${path.sep}`;
  const homeIndex = command.indexOf(homePrefix);
  const distSuffix = `${path.sep}dist${path.sep}cli.js`;
  if (homeIndex >= 0) {
    const end = command.indexOf(distSuffix, homeIndex);
    if (end >= 0) return command.slice(homeIndex, end + distSuffix.length);
  }
  return command.split(/\s+/).find((part) => part.endsWith(distSuffix));
}

function findActiveMcpScriptPath(processText, homeDir) {
  const processes = parseProcessTable(processText);
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  const wrappers = processes.filter((process) => (
    process.command.includes("daily-driver-runner.mjs")
    && process.command.includes("--profile chatgpt-system")
  ));
  for (const wrapper of wrappers) {
    const candidate = processes.find((process) => (
      isDescendant(process, wrapper.pid, byPid)
      && process.command.includes("dist/cli.js")
      && process.command.includes(" stdio ")
    ));
    if (candidate) return extractScriptPath(candidate.command, homeDir);
  }
  return undefined;
}

function collectEvidence({ nowMs = Date.now(), windowMinutes, homeDir = homedir() }) {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Unable to determine current user uid.");
  const windowMs = windowMinutes * 60_000;
  const logDir = path.join(homeDir, ".chatgpt-system", "daily-driver");
  const stdoutPath = path.join(logDir, "stdout.log");
  const stderrPath = path.join(logDir, "stderr.log");

  const launch = spawnSync("/bin/launchctl", ["print", `gui/${uid}/${DAILY_DRIVER_LABEL}`], {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const dailyDriver = parseLaunchAgentStatus(launch.stdout, launch.status ?? 1);

  const tunnel = summarizeTunnelLog(readBoundedText(stdoutPath), { nowMs, windowMs });

  const ps = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const scriptPath = ps.status === 0 ? findActiveMcpScriptPath(ps.stdout, homeDir) : undefined;
  const source = classifyRuntimeSource(scriptPath, homeDir);
  const runtimeRoot = scriptPath ? path.dirname(path.dirname(scriptPath)) : undefined;
  const runtime = {
    source,
    distCliPresent: scriptPath ? existsSync(scriptPath) : null,
    nodeModulesPresent: runtimeRoot ? existsSync(path.join(runtimeRoot, "node_modules")) : null,
    zodPresent: runtimeRoot ? existsSync(path.join(runtimeRoot, "node_modules", "zod", "package.json")) : null,
  };

  const stderrStat = safeStat(stderrPath);
  const stderrRecent = stderrStat ? stderrStat.mtimeMs >= nowMs - windowMs : false;
  const stderrText = stderrRecent ? readBoundedText(stderrPath) : "";
  const stderr = {
    recent: stderrRecent,
    dependencyFailureSignature: stderrRecent
      && /ERR_MODULE_NOT_FOUND/.test(stderrText)
      && /Cannot find package ['\"]zod['\"]|package ['\"]zod['\"]/i.test(stderrText),
  };

  return { dailyDriver, tunnel, runtime, stderr };
}

async function main() {
  const { windowMinutes } = parseDiagnosticArgs(process.argv.slice(2));
  const evidence = collectEvidence({ windowMinutes });
  console.log(JSON.stringify(buildDiagnosticReport(evidence, windowMinutes), null, 2));
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[chatgpt-system] connection diagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
