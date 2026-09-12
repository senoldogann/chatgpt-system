import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agentsPath = path.resolve("AGENTS.md");
const projectStatePath = path.resolve("docs/PROJECT_STATE.md");

describe("chatgpt-system continuation protocol", () => {
  it("requires exact project resume, Git reconciliation, concurrent-work preservation, and milestone checkpoints", async () => {
    const agents = await readFile(agentsPath, "utf8");

    for (const required of [
      "chatgpt-system",
      "project_resume",
      "project_checkpoint",
      "docs/PROJECT_STATE.md",
      "git status",
      "git log",
      "git diff",
      "Git/worktree reality",
      "Never reset, clean, revert, overwrite, or delete another agent's work",
      "meaningful milestone",
      "before ending a work session",
      "Next exact step",
    ]) {
      expect(agents, `missing continuation rule: ${required}`).toContain(required);
    }

    expect(agents).toMatch(/Git\/worktree reality[\s\S]*Project Continuity[\s\S]*PROJECT_STATE[\s\S]*plan\/spec/i);
  });

  it("keeps one bounded live handoff document with the fields a fresh chat needs", async () => {
    const state = await readFile(projectStatePath, "utf8");

    for (const heading of [
      "# chatgpt-system — Active Project State",
      "## Current goal",
      "## Active workspace",
      "## Completed",
      "## Current state",
      "## Next exact step",
      "## Invariants",
      "## Verification",
      "## Blockers / uncertainties",
    ]) {
      expect(state, `missing live-state heading: ${heading}`).toContain(heading);
    }

    expect(state).toContain("This file is a handoff cache, not the sole source of truth.");
    expect(state).not.toContain("CONTROL_PLANE_API_KEY=");
  });
});
