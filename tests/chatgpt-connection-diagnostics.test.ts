import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDiagnosticReport,
  classifyConnectionEvidence,
  classifyRuntimeSource,
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
      errorCount: 1,
      stdioFailureCount: 1,
      recentActivity: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret-request");
    expect(serialized).not.toContain("secret-tunnel");
    expect(serialized).not.toContain("secret-client");
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

  it("uses fail-safe classification priority", () => {
    const healthy = {
      dailyDriver: { loaded: true, running: true, neverExited: true },
      tunnel: { forwardedCommandCount: 12, warningCount: 0, errorCount: 0, stdioFailureCount: 0, recentActivity: true },
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
      tunnel: { forwardedCommandCount: 4, warningCount: 0, errorCount: 0, stdioFailureCount: 0, recentActivity: true },
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
