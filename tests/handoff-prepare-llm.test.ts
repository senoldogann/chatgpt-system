import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { HandoffFetchImpl } from "../src/agent/handoff-llm.js";
import { prepareHandoff, type HandoffToolRuntime } from "../src/agent/handoff-tool-registration.js";
import { PolicyError } from "../src/core/errors.js";

const llm = {
  baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
  model: "glm-5.3-flash",
  timeoutMs: 5_000,
};

function ruleRuntime(): HandoffToolRuntime {
  return { config: { goal: { enabled: true, maxTranscriptChars: 120_000 } } };
}

async function authWithKey(key: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "handoff-prepare-auth-"));
  const file = path.join(dir, "auth.json");
  await writeFile(file, JSON.stringify({ "opencode-go": { type: "api", key } }), "utf8");
  return file;
}

function okFetch(draft: string): HandoffFetchImpl {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: draft } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as HandoffFetchImpl;
}

describe("handoff_prepare orkestrasyonu", () => {
  it("summary verilmişse aynen taşır ve llmDrafted false olur", async () => {
    const result = await prepareHandoff(ruleRuntime(), {
      summary: "Sepet taşındı. NEXT: checkout doğrula.",
      planSteps: [],
      continuationToken: "",
      goal: "",
      activity: [],
      decisions: [],
    });
    expect(result.llmDrafted).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.brief).toBe("Sepet taşındı. NEXT: checkout doğrula.");
    expect(result.bootstrap).toContain("Sepet taşındı.");
  });

  it("summary yoksa ham malzemeden LLM taslağı yazar", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runtime: HandoffToolRuntime = {
        config: { goal: { enabled: true, maxTranscriptChars: 120_000, llm } },
        opencodeAuthPath: await authWithKey(`go-key-${"y".repeat(24)}`),
        goalLlmFetch: okFetch('{"brief":"TASK: sepet taşındı. NEXT: checkout."}'),
      };
      const result = await prepareHandoff(runtime, {
        summary: "",
        planSteps: [{ step: "Checkout doğrula", status: "todo" }],
        continuationToken: "tok-1",
        goal: "Sepet modülünü taşı",
        activity: ["fs_write sepet.ts +18 -4"],
        decisions: [],
        nextStep: "Checkout doğrula",
        sessionId: "stable-session",
      });
      expect(result.llmDrafted).toBe(true);
      expect(result.brief).toContain("sepet taşındı");
      expect(result.brief).toContain("[todo] Checkout doğrula");
      expect(result.bootstrap).toContain("tok-1");
    } finally {
      errSpy.mockRestore();
    }
  });

  it("summary ve malzeme yoksa açık hata verir", async () => {
    await expect(
      prepareHandoff(ruleRuntime(), {
        summary: "",
        planSteps: [],
        continuationToken: "",
        goal: "",
        activity: [],
        decisions: [],
      }),
    ).rejects.toBeInstanceOf(PolicyError);
  });

  it("LLM yapılandırması yoksa summary ister", async () => {
    await expect(
      prepareHandoff(ruleRuntime(), {
        summary: "",
        planSteps: [{ step: "İş", status: "todo" }],
        continuationToken: "",
        goal: "İşi bitir",
        activity: [],
        decisions: [],
      }),
    ).rejects.toBeInstanceOf(PolicyError);
  });

  it("anahtar okunamazsa summary ister", async () => {
    const runtime: HandoffToolRuntime = {
      config: { goal: { enabled: true, maxTranscriptChars: 120_000, llm } },
      opencodeAuthPath: "/tmp/handoff-prepare-yok/auth.json",
    };
    await expect(
      prepareHandoff(runtime, {
        summary: "",
        planSteps: [],
        continuationToken: "",
        goal: "İşi bitir",
        activity: ["terminal exit 0"],
        decisions: [],
      }),
    ).rejects.toBeInstanceOf(PolicyError);
  });

  it("LLM arızasında uydurmaz, açık hata verir", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const runtime: HandoffToolRuntime = {
        config: { goal: { enabled: true, maxTranscriptChars: 120_000, llm } },
        opencodeAuthPath: await authWithKey(`go-key-${"z".repeat(24)}`),
        goalLlmFetch: (async () => new Response("yok", { status: 401 })) as HandoffFetchImpl,
      };
      await expect(
        prepareHandoff(runtime, {
          summary: "",
          planSteps: [],
          continuationToken: "",
          goal: "İşi bitir",
          activity: ["terminal exit 0"],
          decisions: [],
        }),
      ).rejects.toBeInstanceOf(PolicyError);
    } finally {
      errSpy.mockRestore();
    }
  });
});
