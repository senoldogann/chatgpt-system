import { describe, expect, it } from "vitest";
import { decideGoal } from "../src/goal-service.js";
import { boundBrief, formatActivityLine, handoffPlanNotice, resumeBootstrapText } from "../src/handoff.js";

describe("goal_advise decision logic", () => {
  it("stops when plan steps and success criteria are complete", async () => {
    const advice = decideGoal({
      objective: "Ship the fix",
      transcriptTail: "Ship the fix is done. All tests pass and the fix is verified.",
      planSteps: [{ step: "Fix bug", status: "done" }],
      successCriteria: ["tests pass"],
    });
    expect(advice.action).toBe("stop");
    expect(advice.reply).toBe("");
  });

  it("continues with the largest remaining work while steps are open", async () => {
    const advice = decideGoal({
      objective: "Ship the fix",
      transcriptTail: "Started work.",
      planSteps: [
        { step: "Fix bug", status: "done" },
        { step: "Add regression test", status: "todo" },
        { step: "Update docs", status: "open" },
      ],
      successCriteria: ["tests pass"],
      nextStep: "Write the test first.",
    });
    expect(advice.action).toBe("continue");
    expect(advice.reply).toContain("Add regression test");
    expect(advice.reply).toContain("Update docs");
    expect(advice.reply).toContain("Write the test first.");
    expect(advice.reason).toContain("2 açık plan adımı");
  });

  it("asks for evidence when the objective is not proven by the transcript", async () => {
    const advice = decideGoal({
      objective: "Migrate the database without downtime",
      transcriptTail: "Did some unrelated cleanup.",
      planSteps: [{ step: "Cleanup", status: "done" }],
      successCriteria: [],
    });
    expect(advice.action).toBe("continue");
    expect(advice.reply).toContain("Migrate the database without downtime");
  });

  it("continues on unmet criteria even when steps look done", async () => {
    const advice = decideGoal({
      objective: "",
      transcriptTail: "Refactored the module.",
      planSteps: [{ step: "Refactor", status: "done" }],
      successCriteria: ["benchmark improves by 2x"],
    });
    expect(advice.action).toBe("continue");
    expect(advice.reply).toContain("benchmark improves by 2x");
  });
});

describe("handoff helpers", () => {
  it("builds a bootstrap message carrying the brief", async () => {
    const bootstrap = resumeBootstrapText("Finish the migration.", "abc123");
    expect(bootstrap).toContain("Finish the migration.");
    expect(bootstrap).toContain("abc123");
    expect(bootstrap).toContain("buradan devam et");
  });

  it("center-trims long briefs and keeps head and tail", async () => {
    const brief = `TASK: migrate\n${"a".repeat(500)}\nNEXT: verify`;
    const bounded = boundBrief(brief, 200);
    expect(bounded.truncated).toBe(true);
    expect(bounded.brief).toContain("TASK: migrate");
    expect(bounded.brief).toContain("NEXT: verify");
    expect(bounded.brief.length).toBeLessThanOrEqual(200);
  });

  it("renders plan notice with statuses", async () => {
    const notice = handoffPlanNotice([{ step: "Migrate", status: "in_progress", details: "half done" }]);
    expect(notice).toContain("[in_progress] Migrate");
    expect(notice).toContain("half done");
    expect(handoffPlanNotice([])).toBe("");
  });

  it("formats one-line activity summaries", async () => {
    expect(formatActivityLine("fs_write", "src/a.ts +18 −4")).toBe("fs_write src/a.ts +18 −4");
    expect(formatActivityLine("terminal_run", "")).toBe("terminal_run");
  });
});
