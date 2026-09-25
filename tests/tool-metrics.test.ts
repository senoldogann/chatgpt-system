import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { toolMetricsPath } from "../src/mcp/tool-metrics.js";
import { createMcpServer, createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { formatSummary, parseMetricLines, parseStatsArgs, summarizeMetrics } from "../scripts/tool-stats.mjs";

const cleanups: string[] = [];
const runtimes: RuntimeServices[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.processSupervisor.close();
    await runtime.browser.close();
  }
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function waitForLines(file: string, count: number): Promise<string[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const lines = (await readFile(file, "utf8").catch(() => "")).split("\n").filter(Boolean);
    if (lines.length >= count) return lines;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("tool metrics were not written");
}

describe("per-tool metrics", () => {
  it("records tool name, outcome, duration and result size without arguments or content", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-tool-metrics-"));
    cleanups.push(base);
    await writeFile(path.join(base, "secret-note.txt"), "TOP-SECRET-CONTENT", "utf8");
    const config = await loadConfig({
      roots: [base],
      auditFile: path.join(base, "state", "audit.jsonl"),
      continuityDatabasePath: path.join(base, "state", "continuity.db"),
    });
    const runtime = createRuntimeServices(config);
    runtimes.push(runtime);
    const server = createMcpServer(runtime);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "tool-metrics", version: "1.0.0" });
    await client.connect(clientTransport);

    await client.callTool({ name: "fs_read", arguments: { path: "secret-note.txt" } });
    const missing = await client.callTool({ name: "fs_read", arguments: { path: "missing.txt" } });
    expect(missing.isError).toBe(true);
    await client.close();

    const lines = await waitForLines(toolMetricsPath(config.auditFile), 2);
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.map((record) => [record.action, record.target, record.outcome])).toEqual([
      ["mcp.tool", "fs_read", "ok"],
      ["mcp.tool", "fs_read", "error"],
    ]);
    expect((records[0]!.metadata as { resultBytes: number }).resultBytes).toBeGreaterThan(0);
    const raw = lines.join("\n");
    expect(raw).not.toContain("TOP-SECRET-CONTENT");
    expect(raw).not.toContain("secret-note.txt");
    expect(raw).not.toContain("missing.txt");
  });
});

function line(tool: string, durationMs: number, outcome = "ok", minute = 0, resultBytes = 1024): string {
  return JSON.stringify({
    id: `${tool}-${minute}-${durationMs}`,
    timestamp: new Date(Date.UTC(2026, 8, 25, 10, minute)).toISOString(),
    action: "mcp.tool",
    target: tool,
    outcome,
    durationMs,
    metadata: { resultBytes },
  });
}

describe("npm run stats", () => {
  it("summarizes calls, errors, latency percentiles and result sizes per tool", () => {
    const text = [
      line("fs_read", 10), line("fs_read", 20), line("fs_read", 30, "error"),
      line("code_query", 200, "ok", 1, 4096),
      "not json",
      JSON.stringify({ action: "fs.read", outcome: "ok", durationMs: 1, timestamp: new Date().toISOString() }),
    ].join("\n");
    const summary = summarizeMetrics(parseMetricLines(text));
    expect(summary.totalCalls).toBe(4);
    expect(summary.totalErrors).toBe(1);
    expect(summary.tools[0]).toMatchObject({ tool: "fs_read", calls: 3, errors: 1, p50Ms: 20, p95Ms: 30, maxMs: 30, avgResultKb: 1 });
    expect(summary.tools[1]).toMatchObject({ tool: "code_query", calls: 1, avgResultKb: 4 });
    expect(formatSummary(summary)).toContain("fs_read");
  });

  it("hints at polling and unbatched reads, and respects the time window", () => {
    const polls = Array.from({ length: 12 }, (_, index) => line(index % 2 ? "process_status" : "process_logs", 40, "ok", 5));
    const reads = Array.from({ length: 20 }, () => line("fs_read", 5, "ok", 5));
    const summary = summarizeMetrics(parseMetricLines([...polls, ...reads].join("\n")));
    expect(summary.hints.join(" ")).toMatch(/polling.*waitMs/);
    expect(summary.hints.join(" ")).toMatch(/fs_read_many/);

    const late = summarizeMetrics(parseMetricLines(polls.join("\n")), { sinceMs: Date.UTC(2026, 8, 25, 11, 0) });
    expect(late.totalCalls).toBe(0);
    expect(formatSummary(late)).toBe("No tool calls recorded in this window.");
  });

  it("validates arguments", () => {
    expect(parseStatsArgs(["--hours", "2", "--json"], "/home/u")).toMatchObject({ hours: 2, json: true, file: "/home/u/.chatgpt-system/tool-metrics.jsonl" });
    expect(() => parseStatsArgs(["--hours", "0"])).toThrow(/--hours/);
    expect(() => parseStatsArgs(["--nope"])).toThrow(/Unknown option/);
  });
});
