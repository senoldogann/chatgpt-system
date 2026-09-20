import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  classifyConnectionEvidence,
  classifyRuntimeSource,
  detectRuntimeDependencyFailure,
  parseDiagnosticArgs,
  parseLaunchAgentStatus,
  summarizeTunnelLog,
} from "../scripts/diagnose-chatgpt-connection.mjs";

const MINUTE = 60_000;
const NOW = Date.parse("2026-09-15T10:30:00.000Z");

describe("ChatGPT connection diagnostics", () => {
  it("parses a bounded diagnostic window", () => {
    expect(parseDiagnosticArgs([])).toEqual({ windowMinutes: 15 });
    expect(parseDiagnosticArgs(["--minutes", "30"])).toEqual({ windowMinutes: 30 });
    expect(() => parseDiagnosticArgs(["--minutes", "0"])).toThrow(/1.*120/i);
    expect(() => parseDiagnosticArgs(["--minutes", "121"])).toThrow(/1.*120/i);
    expect(() => parseDiagnosticArgs(["--unknown"])).toThrow(/unknown/i);
  });

  it("summarizes only recent safe tunnel metadata and drops identifiers", () => {
    const log = [
      JSON.stringify({
        time: "2026-09-15T10:10:00.000Z",
        level: "WARN",
        msg: "old warning",
        request_id: "secret-old-request",
      }),
      JSON.stringify({
        time: "2026-09-15T10:20:30.000Z",
        level: "INFO",
        msg: "dispatcher forwarded command to MCP server",
        request_id: "secret-request",
        tunnel_id: "secret-tunnel",
        client_instance_id: "secret-client",
      }),
      JSON.stringify({
        time: "2026-09-15T10:22:00.000Z",
        level: "WARN",
        msg: "stdio MCP command failed; requesting tunnel-client shutdown",
        reason: "stdio MCP command stdout closed",
        request_id: "secret-request-2",
      }),
      JSON.stringify({
        time: "2026-09-15T10:23:00.000Z",
        level: "ERROR",
        msg: "some error",
      }),
      "not-json",
    ].join("\n");

    const summary = summarizeTunnelLog(log, { nowMs: NOW, windowMs: 15 * MINUTE });

    expect(summary).toEqual({
      forwardedCommandCount: 1,
      warningCount: 1,
      recoveredPollBackoffCount: 0,
      errorCount: 1,
      stdioFailureCount: 1,
      recentActivity: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret-request");
    expect(serialized).not.toContain("secret-tunnel");
    expect(serialized).not.toContain("secret-client");
  });

  it("separates a recovered poll backoff from unrecovered tunnel warnings", () => {
    const healthyLocal = {
      dailyDriver: { loaded: true, running: true, neverExited: true },
      runtime: { source: "stable-runtime" as const, distCliPresent: true, nodeModulesPresent: true, zodPresent: true },
      stderr: { recent: false, dependencyFailureSignature: false },
    };
    const forwarded = JSON.stringify({
      time: "2026-09-15T10:20:00.000Z",
      level: "INFO",
      msg: "dispatcher forwarded command to MCP server",
    });
    const backoff = JSON.stringify({
      time: "2026-09-15T10:21:00.000Z",
      level: "WARN",
      msg: "poll timed out; backing off",
    });
    const recovered = JSON.stringify({
      time: "2026-09-15T10:21:30.000Z",
      level: "INFO",
      msg: "poller recovered; polling operational",
    });

    const healed = summarizeTunnelLog([forwarded, backoff, recovered].join("\n"), { nowMs: NOW, windowMs: 15 * MINUTE });
    expect(healed).toMatchObject({ warningCount: 1, recoveredPollBackoffCount: 1, errorCount: 0, stdioFailureCount: 0 });
    expect(classifyConnectionEvidence({ ...healthyLocal, tunnel: healed }))
      .toBe("LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE");

    const stillBackingOff = summarizeTunnelLog([forwarded, backoff].join("\n"), { nowMs: NOW, windowMs: 15 * MINUTE });
    expect(stillBackingOff).toMatchObject({ warningCount: 1, recoveredPollBackoffCount: 0 });
    expect(classifyConnectionEvidence({ ...healthyLocal, tunnel: stillBackingOff }))
      .toBe("LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE");

    const unrelatedWarning = summarizeTunnelLog([
      forwarded,
      backoff,
      recovered,
      JSON.stringify({ time: "2026-09-15T10:22:00.000Z", level: "WARN", msg: "stdio MCP command failed; requesting tunnel-client shutdown" }),
    ].join("\n"), { nowMs: NOW, windowMs: 15 * MINUTE });
    expect(unrelatedWarning).toMatchObject({ warningCount: 2, recoveredPollBackoffCount: 1 });
    expect(classifyConnectionEvidence({ ...healthyLocal, tunnel: unrelatedWarning }))
      .toBe("LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE");
  });

  it("treats every poller retry wording it actually recovers from as transient", () => {
    const dailyDriver = { loaded: true, running: true, neverExited: true };
    const runtime = { source: "stable-runtime" as const, distCliPresent: true, nodeModulesPresent: true, zodPresent: true };
    const stderr = { recent: false, dependencyFailureSignature: false };
    const forwarded = JSON.stringify({
      time: "2026-09-15T10:20:00.000Z",
      level: "INFO",
      msg: "dispatcher forwarded command to MCP server",
    });
    const recovered = JSON.stringify({
      time: "2026-09-15T10:21:30.000Z",
      level: "INFO",
      msg: "poller recovered; polling operational",
    });
    // Regression: the live tunnel logged this wording eight times in the retained window and
    // recovered from each one, but only the "timed out" variant was recognised, so a healed
    // backoff still reported LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE.
    const failed = JSON.stringify({
      time: "2026-09-15T10:21:00.000Z",
      level: "WARN",
      msg: "poll failed; backing off",
    });

    const healed = summarizeTunnelLog([forwarded, failed, recovered].join("\n"), { nowMs: NOW, windowMs: 15 * MINUTE });
    expect(healed).toMatchObject({ warningCount: 1, recoveredPollBackoffCount: 1, errorCount: 0, stdioFailureCount: 0 });
    expect(classifyConnectionEvidence({ dailyDriver, runtime, tunnel: healed, stderr }))
      .toBe("LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE");

    const stillBackingOff = summarizeTunnelLog([forwarded, failed].join("\n"), { nowMs: NOW, windowMs: 15 * MINUTE });
    expect(stillBackingOff).toMatchObject({ warningCount: 1, recoveredPollBackoffCount: 0 });
    expect(classifyConnectionEvidence({ dailyDriver, runtime, tunnel: stillBackingOff, stderr }))
      .toBe("LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE");

    // A poller retry wording that is not a backoff must keep its failure weight.
    const otherWarning = JSON.stringify({
      time: "2026-09-15T10:21:00.000Z",
      level: "WARN",
      msg: "poll response already fulfilled or unknown request",
    });
    const unrelated = summarizeTunnelLog([forwarded, otherWarning, recovered].join("\n"), { nowMs: NOW, windowMs: 15 * MINUTE });
    expect(unrelated).toMatchObject({ warningCount: 1, recoveredPollBackoffCount: 0 });
    expect(classifyConnectionEvidence({ dailyDriver, runtime, tunnel: unrelated, stderr }))
      .toBe("LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE");
  });

  it("parses launchd state without exposing process identifiers", () => {
    const status = parseLaunchAgentStatus(`
      state = running
      runs = 1
      pid = 73687
      last exit code = (never exited)
    `, 0);

    expect(status).toEqual({ loaded: true, running: true, neverExited: true });
    expect(JSON.stringify(status)).not.toContain("73687");
    expect(parseLaunchAgentStatus("", 113)).toEqual({ loaded: false, running: false, neverExited: null });
  });

  it("classifies runtime source without returning its path", () => {
    const home = "/Users/example";
    expect(classifyRuntimeSource(
      "/Users/example/.chatgpt-system/runtime/chatgpt-system-main/dist/cli.js",
      home,
    )).toBe("stable-runtime");
    expect(classifyRuntimeSource(
      "/Users/example/.chatgpt-system/worktrees/abc/def/dist/cli.js",
      home,
    )).toBe("managed-worktree");
    expect(classifyRuntimeSource("/opt/custom/chatgpt-system/dist/cli.js", home)).toBe("other");
    expect(classifyRuntimeSource(undefined, home)).toBe("unknown");
  });

  it("attributes a dependency failure signature only to the active runtime", () => {
    const runtimeRoot = "/Users/example/.chatgpt-system/runtime/chatgpt-system-main";
    const foreignFailure = [
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod' imported from /Users/example/.chatgpt-system/worktrees/abc/def/dist/control-protocol.js",
      "    at packageResolve (node:internal/modules/esm/resolve:873:9)",
      "  code: 'ERR_MODULE_NOT_FOUND'",
    ].join("\n");
    // Regression: the bounded stderr window keeps stale failures from a previous tunnel target,
    // so an unscoped signature reported a dependency failure the active runtime never had.
    expect(detectRuntimeDependencyFailure(foreignFailure, runtimeRoot)).toBe(false);

    const ownFailure = foreignFailure.replace(
      "/Users/example/.chatgpt-system/worktrees/abc/def/dist/control-protocol.js",
      `${runtimeRoot}/dist/control-protocol.js`,
    );
    expect(detectRuntimeDependencyFailure(ownFailure, runtimeRoot)).toBe(true);

    expect(detectRuntimeDependencyFailure("", runtimeRoot)).toBe(false);
    expect(detectRuntimeDependencyFailure(ownFailure, undefined)).toBe(false);
    expect(detectRuntimeDependencyFailure(ownFailure, "")).toBe(false);

    // A sibling directory that merely shares the prefix is not the active runtime.
    expect(detectRuntimeDependencyFailure(ownFailure.replace(runtimeRoot, `${runtimeRoot}-old`), runtimeRoot)).toBe(false);
    // An unrelated missing module is not the known runtime dependency failure.
    expect(detectRuntimeDependencyFailure(ownFailure.replace("'zod'", "'left-pad'"), runtimeRoot)).toBe(false);
    // A stray mention without a resolvable import path cannot be attributed.
    expect(detectRuntimeDependencyFailure("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'zod'", runtimeRoot)).toBe(false);
  });

  it("uses fail-safe classification priority", () => {
    const healthy = {
      dailyDriver: { loaded: true, running: true, neverExited: true },
      tunnel: { forwardedCommandCount: 12, warningCount: 0, recoveredPollBackoffCount: 0, errorCount: 0, stdioFailureCount: 0, recentActivity: true },
      runtime: { source: "stable-runtime" as const, distCliPresent: true, nodeModulesPresent: true, zodPresent: true },
      stderr: { recent: false, dependencyFailureSignature: false },
    };

    expect(classifyConnectionEvidence(healthy)).toBe("LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE");
    expect(classifyConnectionEvidence({
      ...healthy,
      dailyDriver: { loaded: false, running: false, neverExited: null },
    })).toBe("DAILY_DRIVER_UNAVAILABLE");
    expect(classifyConnectionEvidence({
      ...healthy,
      runtime: { ...healthy.runtime, zodPresent: false },
    })).toBe("LOCAL_RUNTIME_DEPENDENCY_FAILURE");
    expect(classifyConnectionEvidence({
      ...healthy,
      stderr: { recent: true, dependencyFailureSignature: true },
    })).toBe("LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE");
    expect(classifyConnectionEvidence({
      ...healthy,
      tunnel: { ...healthy.tunnel, warningCount: 1, stdioFailureCount: 1 },
    })).toBe("LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE");
    expect(classifyConnectionEvidence({
      ...healthy,
      tunnel: { ...healthy.tunnel, forwardedCommandCount: 0, recentActivity: false },
    })).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("builds a bounded public report with no raw local identifiers", () => {
    const report = buildDiagnosticReport({
      dailyDriver: { loaded: true, running: true, neverExited: true },
      tunnel: { forwardedCommandCount: 4, warningCount: 0, recoveredPollBackoffCount: 0, errorCount: 0, stdioFailureCount: 0, recentActivity: true },
      runtime: { source: "managed-worktree", distCliPresent: true, nodeModulesPresent: true, zodPresent: true },
      stderr: { recent: false, dependencyFailureSignature: false },
    }, 15);

    expect(report).toMatchObject({
      diagnosis: "LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE",
      windowMinutes: 15,
      runtime: { source: "managed-worktree" },
    });
    expect(report.guidance.join(" ")).toMatch(/do not remove|repoint/i);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/request_id|tunnel_id|client_instance_id|pid|commandPath/i);
  });

  it("exposes the privacy-safe diagnostic through npm", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts?.["diagnose:chatgpt"])
      .toBe("node scripts/diagnose-chatgpt-connection.mjs");
  });
});
