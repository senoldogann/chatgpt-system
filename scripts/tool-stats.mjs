#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tool-metrics.jsonl özetini verir: hangi araç kaç kez çağrıldı, ne kadar
// sürdü, ne kadar hata verdi ve yanıtları ne kadar büyük. Kayıtlar içerik
// taşımaz; bu betik yalnızca yerel dosyayı okur.

const DEFAULT_HOURS = 24;
const MAX_HOURS = 24 * 30;

export function parseStatsArgs(argv, homeDir = homedir()) {
  const options = { hours: DEFAULT_HOURS, file: path.join(homeDir, ".chatgpt-system", "tool-metrics.jsonl"), json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--hours" || arg === "--file") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === "--file") options.file = path.resolve(value);
      else {
        const hours = Number(value);
        if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) throw new Error(`--hours must be between 0 and ${MAX_HOURS}.`);
        options.hours = hours;
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function parseMetricLines(text) {
  const records = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if (value?.action !== "mcp.tool" || typeof value.target !== "string") continue;
      const timestampMs = Date.parse(value.timestamp);
      if (!Number.isFinite(timestampMs) || typeof value.durationMs !== "number") continue;
      records.push({
        tool: value.target,
        timestampMs,
        durationMs: value.durationMs,
        ok: value.outcome === "ok",
        resultBytes: typeof value.metadata?.resultBytes === "number" ? value.metadata.resultBytes : 0,
      });
    } catch {
      // Yarım yazılmış ya da bozuk satır özeti bozmaz.
    }
  }
  return records;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function summarizeMetrics(records, { sinceMs = 0 } = {}) {
  const inWindow = records.filter((record) => record.timestampMs >= sinceMs);
  const byTool = new Map();
  for (const record of inWindow) {
    const entry = byTool.get(record.tool) ?? { tool: record.tool, calls: 0, errors: 0, durations: [], resultBytes: 0 };
    entry.calls += 1;
    if (!record.ok) entry.errors += 1;
    entry.durations.push(record.durationMs);
    entry.resultBytes += record.resultBytes;
    byTool.set(record.tool, entry);
  }
  const tools = [...byTool.values()].map((entry) => {
    const sorted = [...entry.durations].sort((left, right) => left - right);
    return {
      tool: entry.tool,
      calls: entry.calls,
      errors: entry.errors,
      p50Ms: Math.round(percentile(sorted, 0.5)),
      p95Ms: Math.round(percentile(sorted, 0.95)),
      maxMs: Math.round(sorted.at(-1) ?? 0),
      totalSeconds: Math.round(sorted.reduce((sum, value) => sum + value, 0) / 100) / 10,
      avgResultKb: Math.round(entry.resultBytes / entry.calls / 102.4) / 10,
    };
  }).sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool));

  const processPolls = inWindow.filter((record) => record.tool === "process_status" || record.tool === "process_logs");
  const quickPolls = processPolls.filter((record) => record.durationMs < 1_000).length;
  const hints = [];
  if (processPolls.length >= 10 && quickPolls / processPolls.length > 0.5) {
    hints.push(`${quickPolls} of ${processPolls.length} process status/log calls returned in under 1 s: the model is polling. Ask it to use process_logs with cursor and waitMs.`);
  }
  const readCalls = inWindow.filter((record) => record.tool === "fs_read").length;
  const batchReads = inWindow.filter((record) => record.tool === "fs_read_many").length;
  if (readCalls >= 20 && batchReads === 0) {
    hints.push(`${readCalls} single-file fs_read calls and no fs_read_many: batching independent reads saves model steps.`);
  }
  const erroring = tools.filter((entry) => entry.calls >= 5 && entry.errors / entry.calls >= 0.3);
  for (const entry of erroring) hints.push(`${entry.tool} failed ${entry.errors} of ${entry.calls} calls; check its error codes.`);

  return {
    windowStart: inWindow.length > 0 ? new Date(Math.min(...inWindow.map((record) => record.timestampMs))).toISOString() : null,
    windowEnd: inWindow.length > 0 ? new Date(Math.max(...inWindow.map((record) => record.timestampMs))).toISOString() : null,
    totalCalls: inWindow.length,
    totalErrors: inWindow.filter((record) => !record.ok).length,
    tools,
    hints,
  };
}

export function formatSummary(summary) {
  if (summary.totalCalls === 0) return "No tool calls recorded in this window.";
  const header = ["tool", "calls", "errors", "p50 ms", "p95 ms", "max ms", "total s", "avg KB"];
  const rows = summary.tools.map((entry) => [
    entry.tool, entry.calls, entry.errors, entry.p50Ms, entry.p95Ms, entry.maxMs, entry.totalSeconds, entry.avgResultKb,
  ].map(String));
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells) => cells.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join("  ");
  const output = [
    `Tool calls: ${summary.totalCalls} (${summary.totalErrors} errors) from ${summary.windowStart} to ${summary.windowEnd}`,
    "",
    line(header),
    ...rows.map(line),
  ];
  if (summary.hints.length > 0) output.push("", "Hints:", ...summary.hints.map((hint) => `- ${hint}`));
  return output.join("\n");
}

function readMetrics(file) {
  return [`${file}.1`, file].filter((candidate) => existsSync(candidate)).map((candidate) => readFileSync(candidate, "utf8")).join("\n");
}

function main() {
  const options = parseStatsArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: npm run stats -- [--hours 24] [--file ~/.chatgpt-system/tool-metrics.jsonl] [--json]");
    return;
  }
  const records = parseMetricLines(readMetrics(options.file));
  const summary = summarizeMetrics(records, { sinceMs: Date.now() - options.hours * 3_600_000 });
  console.log(options.json ? JSON.stringify(summary, null, 2) : formatSummary(summary));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[chatgpt-system] stats failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
