import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { registerProjectContinuityTools } from "../src/project-continuity-tool-registration.js";

interface RegisteredTool {
  definition: { description?: string };
}

function continuityDescriptions() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, definition: RegisteredTool["definition"]) {
      tools.set(name, { definition });
    },
  };
  const notCalled = async () => { throw new Error("not called"); };
  registerProjectContinuityTools(server as never, {
    continuity: {
      register: notCalled,
      resume: notCalled,
      checkpoint: notCalled,
      contextRead: notCalled,
    },
  } as never);
  return tools;
}

describe("ChatGPT Web project resilience guidance", () => {
  it("makes resume/checkpoint guidance proactive around hosted MCP capability loss", () => {
    const tools = continuityDescriptions();
    const resume = tools.get("project_resume")?.definition.description ?? "";
    const checkpoint = tools.get("project_checkpoint")?.definition.description ?? "";

    expect(resume).toMatch(/capability.*returns|recovered chat/i);
    expect(resume).toMatch(/before.*project mutation|before.*mutation/i);
    expect(checkpoint).toMatch(/long|tool-heavy|remote-sensitive/i);
    expect(checkpoint).toMatch(/between messages|capability.*disappear/i);
  });

  it("requires fail-closed product-surface handoff, batching, and cleanup guards", async () => {
    const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");

    expect(agents).toContain("risk checkpoint");
    expect(agents).toContain("This conversation does not support developer MCPs");
    expect(agents).toContain("Connection interrupted. Waiting for the complete answer");
    expect(agents).toContain("npm run diagnose:chatgpt");
    expect(agents).toMatch(/new supported standard text chat/i);
    expect(agents).toMatch(/do not.*repeatedly.*retry|never.*repeatedly.*retry/i);
    expect(agents).toMatch(/batch|parallel/i);
    expect(agents).toMatch(/do not.*widen.*(authority|filesystem scope)|never.*widen.*(authority|filesystem scope)/i);
    expect(agents).toMatch(/managed-worktree[\s\S]*do not remove|do not remove[\s\S]*managed-worktree/i);
  });

  it("keeps system capability descriptions aligned with the product-surface boundary", async () => {
    const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");

    expect(server).toContain("This conversation does not support developer MCPs");
    expect(server).toMatch(/do not.*repeatedly.*retry|never.*repeatedly.*retry/i);
    expect(server).toMatch(/new.*chat|recovered chat/i);
    expect(server).toMatch(/project_resume[\s\S]*before.*mutation|before.*mutation[\s\S]*project_resume/i);
  });
  it("runs free mode without persistent admin authority and resumes projects first", async () => {
    const [agents, readme] = await Promise.all([
      readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
    ]);
    expect(agents).not.toMatch(/persistent_owner_mode/);
    expect(agents).toMatch(/Serbest mod/);
    expect(agents).toMatch(/project_resume.*before.*mutation|before.*mutation[\s\S]*project_resume/i);
    expect(readme).not.toMatch(/persistent_owner_mode/);
    expect(readme).toMatch(/project_resume.*first|project_resume.*later chats/i);
  });

});
