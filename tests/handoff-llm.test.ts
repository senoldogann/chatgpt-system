import { describe, expect, it, vi } from "vitest";
import {
  draftBriefWithLlm,
  HandoffLlmApiError,
  HandoffLlmResponseError,
  type HandoffFetchImpl,
  type HandoffLlmRequest,
} from "../src/agent/handoff-llm.js";
import type { GoalLlmConfig } from "../src/core/config.js";

const config: GoalLlmConfig = {
  baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
  model: "glm-5.3-flash",
  timeoutMs: 5_000,
};

const apiKey = `go-key-${"x".repeat(24)}`;

function request(): HandoffLlmRequest {
  return {
    apiKey,
    sessionId: "test-session",
    goal: "Sepet modülünü taşı",
    activity: ["fs_write sepet.ts +18 -4", "terminal exit 0"],
    planSteps: [{ step: "Sepeti taşı", status: "done" }],
    decisions: ["Vitest ile doğrula"],
    nextStep: "Checkout doğrula",
  };
}

function okFetch(draft: string): HandoffFetchImpl {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: draft } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as HandoffFetchImpl;
}

describe("handoff LLM istemcisi", () => {
  it("geçerli taslağı çözer", async () => {
    const brief = await draftBriefWithLlm(
      config,
      request(),
      okFetch('{"brief":"TASK: sepet taşındı. NEXT: checkout doğrula."}'),
    );
    expect(brief).toContain("sepet taşındı");
  });

  it("retryable hatada yeniden dener ve başarır", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      let calls = 0;
      const flaky = (async () => {
        calls += 1;
        if (calls === 1) return new Response("kapasite dolu", { status: 503 });
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"brief":"TASK: bitti."}' } }] }), {
          status: 200,
        });
      }) as HandoffFetchImpl;
      const brief = await draftBriefWithLlm(config, request(), flaky);
      expect(brief).toBe("TASK: bitti.");
      expect(calls).toBe(2);
      expect(errSpy).toHaveBeenCalledOnce();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("retryable olmayan hatada hemen yükseltir", async () => {
    const unauthorized = (async () => new Response("yok", { status: 401 })) as HandoffFetchImpl;
    await expect(draftBriefWithLlm(config, request(), unauthorized)).rejects.toBeInstanceOf(HandoffLlmApiError);
  });

  it("şema dışı taslakta yanıt hatası verir", async () => {
    await expect(
      draftBriefWithLlm(config, request(), okFetch('{"action":"stop"}')),
    ).rejects.toBeInstanceOf(HandoffLlmResponseError);
  });

  it("boş taslakta yanıt hatası verir", async () => {
    await expect(
      draftBriefWithLlm(config, request(), okFetch('{"brief":""}')),
    ).rejects.toBeInstanceOf(HandoffLlmResponseError);
  });

  it("hata gövdesi anahtarı taşımaz", async () => {
    const failing = (async () => new Response("reddedildi", { status: 500 })) as HandoffFetchImpl;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const error = await draftBriefWithLlm(config, request(), failing).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HandoffLlmApiError);
      const body = (error as HandoffLlmApiError).responseBody;
      expect(body).not.toContain(apiKey);
      expect(JSON.stringify(errSpy.mock.calls)).not.toContain(apiKey);
    } finally {
      errSpy.mockRestore();
    }
  });
});
