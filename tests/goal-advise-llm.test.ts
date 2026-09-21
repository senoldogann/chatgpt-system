import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { adviseGoal, type GoalToolRuntime } from "../src/goal-tool-registration.js";
import type { FetchImpl } from "../src/goal-llm.js";

function ruleRuntime(): GoalToolRuntime {
  return { config: { goal: { enabled: true, maxTranscriptChars: 120_000 } } };
}

async function authWithKey(key: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "goal-advise-auth-"));
  const file = path.join(dir, "auth.json");
  await writeFile(file, JSON.stringify({ "opencode-go": { type: "api", key } }), "utf8");
  return file;
}

function okFetch(decision: string): FetchImpl {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: decision } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as FetchImpl;
}

describe("goal_advise orkestrasyonu", () => {
  it("llm yoksa kural motoruyla çalışır", async () => {
    const advice = await adviseGoal(ruleRuntime(), {
      objective: "Ship",
      transcriptTail: "Started.",
      planSteps: [{ step: "Work", status: "todo" }],
      successCriteria: [],
    });
    expect(advice.action).toBe("continue");
    expect(advice.reason).not.toContain("kural motoru");
  });

  it("anahtar ve LLM varsa LLM kararını döner", async () => {
    const runtime: GoalToolRuntime = {
      config: {
        goal: {
          enabled: true,
          maxTranscriptChars: 120_000,
          llm: { baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", model: "glm-5.3-flash", timeoutMs: 5_000 },
        },
      },
      opencodeAuthPath: await authWithKey(`go-key-${"y".repeat(24)}`),
      goalLlmFetch: okFetch('{"action":"stop","reply":""}'),
    };
    const advice = await adviseGoal(runtime, {
      objective: "Ship",
      transcriptTail: "Done.",
      planSteps: [{ step: "Work", status: "done" }],
      successCriteria: [],
      sessionId: "stable-session",
    });
    expect(advice.action).toBe("stop");
    expect(advice.reason).toContain("glm-5.3-flash");
  });

  it("LLM arızasında kural motoruna düşer ve sebebi yazar", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runtime: GoalToolRuntime = {
        config: {
          goal: {
            enabled: true,
            maxTranscriptChars: 120_000,
            llm: { baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", model: "glm-5.3-flash", timeoutMs: 5_000 },
          },
        },
        opencodeAuthPath: await authWithKey(`go-key-${"z".repeat(24)}`),
        goalLlmFetch: (async () => new Response("yok", { status: 401 })) as FetchImpl,
      };
      const advice = await adviseGoal(runtime, {
        objective: "Ship",
        transcriptTail: "Started.",
        planSteps: [{ step: "Work", status: "todo" }],
        successCriteria: [],
      });
      expect(advice.action).toBe("continue");
      expect(advice.reason).toContain("kural motoru");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("anahtar okunamazsa kural motoruna düşer", async () => {
    const runtime: GoalToolRuntime = {
      config: {
        goal: {
          enabled: true,
          maxTranscriptChars: 120_000,
          llm: { baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", model: "glm-5.3-flash", timeoutMs: 5_000 },
        },
      },
      opencodeAuthPath: "/tmp/goal-advise-yok/auth.json",
    };
    const advice = await adviseGoal(runtime, {
      objective: "Ship",
      transcriptTail: "Started.",
      planSteps: [{ step: "Work", status: "todo" }],
      successCriteria: [],
    });
    expect(advice.action).toBe("continue");
    expect(advice.reason).toContain("kural motoru");
  });
});
