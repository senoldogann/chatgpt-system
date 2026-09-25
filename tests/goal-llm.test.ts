import { describe, expect, it, vi } from "vitest";
import {
  adviseWithLlm,
  GOAL_LLM_MAX_ATTEMPTS,
  GoalLlmApiError,
  GoalLlmResponseError,
  type FetchImpl,
  type GoalLlmConfig,
  type GoalLlmRequest,
} from "../src/agent/goal-llm.js";

const config: GoalLlmConfig = {
  baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
  model: "glm-5.3-flash",
  timeoutMs: 5_000,
};

function request(): GoalLlmRequest {
  return {
    apiKey: `go-key-${"x".repeat(24)}`,
    sessionId: "test-session",
    objective: "Migrasyonu bitir",
    transcriptTail: "Yarıda kaldı.",
    planSteps: [{ step: "Migrasyon", status: "todo" }],
    successCriteria: ["testler geçer"],
    nextStep: null,
  };
}

function okFetch(decision: string): FetchImpl {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: decision } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as FetchImpl;
}

describe("goal LLM istemcisi", () => {
  it("geçerli kararı çözer", async () => {
    const advice = await adviseWithLlm(
      config,
      request(),
      okFetch('{"action":"continue","reply":"Migrasyonu bitir ve testleri koş."}'),
    );
    expect(advice.action).toBe("continue");
    expect(advice.reply).toContain("Migrasyonu bitir");
    expect(advice.reason).toContain("glm-5.3-flash");
  });

  it("stop kararını aynen geçirir", async () => {
    const advice = await adviseWithLlm(config, request(), okFetch('{"action":"stop","reply":""}'));
    expect(advice.action).toBe("stop");
    expect(advice.reply).toBe("");
  });

  it("retryable hatada yeniden dener ve başarır", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let calls = 0;
      const flaky = (async () => {
        calls += 1;
        if (calls === 1) return new Response("kapasite dolu", { status: 500 });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"action":"stop","reply":""}' } }] }), {
          status: 200,
        });
      }) as FetchImpl;
      const advice = await adviseWithLlm(config, request(), flaky);
      expect(advice.action).toBe("stop");
      expect(calls).toBe(2);
      expect(errSpy).toHaveBeenCalledOnce();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("retryable olmayan hatada hemen yükseltir", async () => {
    const unauthorized = (async () => new Response("yok", { status: 401 })) as FetchImpl;
    await expect(adviseWithLlm(config, request(), unauthorized)).rejects.toBeInstanceOf(GoalLlmApiError);
  });

  it("denemeler tükenince son hatayı yükseltir", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let calls = 0;
      const down = (async () => {
        calls += 1;
        return new Response("x", { status: 503 });
      }) as FetchImpl;
      await expect(adviseWithLlm(config, request(), down)).rejects.toBeInstanceOf(GoalLlmApiError);
      expect(calls).toBe(GOAL_LLM_MAX_ATTEMPTS);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("şema dışı kararı reddeder", async () => {
    await expect(adviseWithLlm(config, request(), okFetch('{"action":"belki","reply":"x"}'))).rejects.toBeInstanceOf(
      GoalLlmResponseError,
    );
  });

  it("boş choice listesini reddeder", async () => {
    const empty = (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as FetchImpl;
    await expect(adviseWithLlm(config, request(), empty)).rejects.toBeInstanceOf(GoalLlmResponseError);
  });
});
