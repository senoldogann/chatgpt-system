import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readDocs() {
  const [readme, runbook] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/CHATGPT_WEB_RESILIENCE.md", import.meta.url), "utf8"),
  ]);
  return { readme, runbook };
}

describe("ChatGPT Web project resilience documentation", () => {
  it("documents the no-at-picker recovery path through a new chat and continuity resume", async () => {
    const { readme, runbook } = await readDocs();

    for (const doc of [readme, runbook]) {
      expect(doc).toContain("This conversation does not support developer MCPs");
      expect(doc).toContain("@chatgpt-system-local");
      expect(doc).toMatch(/no longer appears|disappears|absent/i);
      expect(doc).toMatch(/new supported standard text chat/i);
      expect(doc).toMatch(/same Project/i);
      expect(doc).toContain("project_resume");
      expect(doc).toMatch(/first.*project.*action|before.*project mutation/i);
      expect(doc).toMatch(/do not.*repeatedly|do not.*keep trying|never.*retry/i);
    }
  });

  it("separates Web stream interruption from local tunnel failure", async () => {
    const { readme, runbook } = await readDocs();

    for (const doc of [readme, runbook]) {
      expect(doc).toContain("Connection interrupted. Waiting for the complete answer");
      expect(doc).toContain("npm run diagnose:chatgpt");
      expect(doc).toMatch(/not.*evidence.*local|not.*proof.*local/i);
      expect(doc).toMatch(/do not restart|never restart/i);
      expect(doc).toMatch(/container.*not.*Mac|do not.*container/i);
    }
  });

  it("documents incident deadlines, read-only health evidence and short managed-process polling", async () => {
    const { runbook } = await readDocs();
    const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
    expect(runbook).toContain("MCP_RESPONSE_DEADLINE_EVIDENCE");
    expect(runbook).toContain("--at");
    expect(runbook).toContain("/health/mcp");
    expect(runbook).toContain("/health?details=true");
    expect(runbook).toContain("max_concurrent_requests");
    for (const value of ["process_start", "process_status", "process_logs"]) {
      expect(runbook).toContain(value);
      expect(agents).toContain(value);
    }
    expect(runbook).toMatch(/deadline.*not.*daemon|deadline.*without.*daemon/i);
    expect(runbook).toMatch(/not.*increase.*concurrency|do not.*increase.*concurrency/i);
  });

  it("documents diagnostic interpretation and managed-worktree cleanup safety", async () => {
    const { runbook } = await readDocs();

    expect(runbook).toContain("LOCAL_HEALTHY_NO_LOCAL_FAILURE_EVIDENCE");
    expect(runbook).toContain("LOCAL_TUNNEL_OR_MCP_FAILURE_EVIDENCE");
    expect(runbook).toContain("LOCAL_RUNTIME_DEPENDENCY_FAILURE");
    expect(runbook).toContain("DAILY_DRIVER_UNAVAILABLE");
    expect(runbook).toContain("INSUFFICIENT_EVIDENCE");
    expect(runbook).toContain("managed-worktree");
    expect(runbook).toMatch(/do not remove|must not remove/i);
    expect(runbook).toMatch(/request ID|correlation/i);
    expect(runbook).toMatch(/OpenAI Support/i);
  });
});
