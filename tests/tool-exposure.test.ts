import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { applyToolExposure, isToolExposed, type ToolExposureConfig } from "../src/tool-exposure.js";
import { getTrackedToolSurface, trackToolSurface } from "../src/tool-surface-publication.js";

function config(overrides: Partial<{
  toolProfile: "full" | "dev";
  terminal: boolean;
  projectExec: boolean;
  ownerRuntime: boolean;
  browser: boolean;
  computerUse: boolean;
  fullHostJs: boolean;
}> = {}): ToolExposureConfig {
  return {
    ...(overrides.toolProfile !== undefined ? { toolProfile: overrides.toolProfile } : {}),
    terminal: { enabled: overrides.terminal ?? false, commands: ["node"] },
    projectExec: { enabled: overrides.projectExec ?? false },
    ownerRuntime: { enabled: overrides.ownerRuntime ?? false },
    browser: { enabled: overrides.browser ?? false },
    computerUse: { enabled: overrides.computerUse ?? false, fullHostJsEnabled: overrides.fullHostJs ?? false },
  };
}

const allEnabled = {
  terminal: true,
  projectExec: true,
  ownerRuntime: true,
  browser: true,
  computerUse: true,
  fullHostJs: true,
};

const coreTools = [
  "system_capabilities", "fs_read", "fs_write", "git_status", "git_push", "code_query",
  "project_resume", "project_check", "task_state", "skills_list", "goal_advise", "worker_spawn", "handoff_prepare",
];

describe("tool exposure policy", () => {
  it("always publishes core project tools, whatever the gates or profile", () => {
    for (const profile of ["full", "dev"] as const) {
      for (const tool of coreTools) {
        expect(isToolExposed(tool, config({ toolProfile: profile })), `${profile}:${tool}`).toBe(true);
      }
    }
  });

  it("hides every tool whose capability gate is disabled", () => {
    const disabled = config();
    for (const tool of [
      "browser_navigate", "computer_click", "computer_run", "computer_run_js", "shell_run",
      "terminal_session_open", "terminal_run", "process_start", "process_logs", "project_exec",
    ]) {
      expect(isToolExposed(tool, disabled), tool).toBe(false);
    }
  });

  it("publishes gated tools once their gate is enabled in the full profile", () => {
    const enabled = config(allEnabled);
    for (const tool of [
      "browser_navigate", "computer_click", "computer_run_js", "shell_run",
      "terminal_session_open", "terminal_run", "process_start", "project_exec",
    ]) {
      expect(isToolExposed(tool, enabled), tool).toBe(true);
    }
  });

  it("requires both Computer Runtime and full-host JS for computer_run_js", () => {
    expect(isToolExposed("computer_run_js", config({ computerUse: true }))).toBe(false);
    expect(isToolExposed("computer_click", config({ computerUse: true }))).toBe(true);
  });

  it("dev profile hides desktop, browser and owner-shell tools even when enabled", () => {
    const dev = config({ ...allEnabled, toolProfile: "dev" });
    for (const tool of ["browser_navigate", "computer_click", "computer_run_js", "shell_run", "terminal_session_write"]) {
      expect(isToolExposed(tool, dev), tool).toBe(false);
    }
    for (const tool of ["terminal_run", "process_start", "project_exec"]) {
      expect(isToolExposed(tool, dev), tool).toBe(true);
    }
  });

  it("filters registration before tool-surface tracking and the MCP catalog", () => {
    const server = new McpServer({ name: "exposure-test", version: "0.0.0" }, { capabilities: { tools: {} } });
    trackToolSurface(server);
    applyToolExposure(server, config({ ...allEnabled, toolProfile: "dev" }));
    const noop = async () => ({ content: [] });
    server.registerTool("fs_read", { description: "read", inputSchema: z.object({ path: z.string() }) }, noop);
    server.registerTool("shell_run", { description: "shell", inputSchema: z.object({ script: z.string() }) }, noop);
    expect(getTrackedToolSurface(server).map((entry) => entry.name)).toEqual(["fs_read"]);
  });
});
