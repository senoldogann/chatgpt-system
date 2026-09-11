import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const runbookPath = path.resolve("docs/CODING_HARNESS_V2.md");

describe("Coding Harness v2 operator runbook", () => {
  it("documents the complete least-privilege workflow and operator boundaries", async () => {
    const runbook = await readFile(runbookPath, "utf8");

    for (const required of [
      "Project sandbox execution",
      "Admin host execution",
      "npm run setup:project-exec",
      "--enable-project-exec",
      "project_exec",
      "code_query",
      "task_state",
      "fs_apply_patch_set",
      "git_worktree",
      "project_check",
      "browser_console_errors",
      "browser_network_errors",
      "generation",
      "sequence",
      "~/.chatgpt-system/state/",
      "SANDBOX_UNAVAILABLE",
      "LSP_UNAVAILABLE",
      "VERIFICATION_REQUIRED",
      "RECOVERY_REQUIRED",
      "benchmark.mjs list",
      "benchmark.mjs prepare",
      "benchmark.mjs evaluate",
      "CHATGPT_SYSTEM_BENCHMARK_COLLECTOR_KEY",
      "collectorTrust",
      "No host fallback",
      "No automatic push",
    ]) {
      expect(runbook, `missing runbook contract: ${required}`).toContain(required);
    }

    expect(runbook).toContain("UNDERSTAND → SEARCH → PLAN → ISOLATE → EDIT → TEST → DIAGNOSE → VERIFY → CHECKPOINT → REPORT");
    expect(runbook).toContain("Docker daemon is trusted infrastructure");
    expect(runbook).toContain("Xcode/macOS-native checks");
    expect(runbook).not.toContain("Codex parity achieved");
  });
});
