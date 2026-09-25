import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GoalLlmConfig } from "./config.js";
import { PolicyError } from "./errors.js";
import { boundBrief, handoffPlanNotice, resumeBootstrapText } from "./handoff.js";
import { draftBriefWithLlm, type HandoffFetchImpl } from "./handoff-llm.js";
import { defaultOpencodeAuthPath, readOpencodeGoApiKey } from "./opencode-auth.js";
import { handoffPrepareOutputSchema } from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";

export interface HandoffToolRuntime {
  config: {
    goal: {
      enabled: boolean;
      maxTranscriptChars: number;
      llm?: GoalLlmConfig;
    };
  };
  // Testlerde gerçek ağa çıkılmasın diye enjekte edilir; üretimde global fetch.
  // goal_advise ile aynı alan adı kullanılır, iki tool aynı runtime nesnesini alır.
  goalLlmFetch?: HandoffFetchImpl;
  // Testlerde gerçek ev dizinindeki auth okunmasın diye ezilir.
  opencodeAuthPath?: string;
}

// OpenCode Go anahtarı varsa girdi dış API'ye gider; bu yüzden open-world.
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const MAX_HANDOFF_SUMMARY_CHARS = 8_000;
const MAX_BOOTSTRAP_CHARS = 12_000;

const planStepSchema = z.object({
  step: z.string().min(1).max(2_000),
  status: z.string().min(1).max(64),
  details: z.string().max(4_000).optional(),
}).strict();

const handoffPrepareInputSchema = z.object({
  summary: z.string().max(MAX_HANDOFF_SUMMARY_CHARS).default(""),
  planSteps: z.array(planStepSchema).max(20).default([]),
  continuationToken: z.string().max(256).default(""),
  // summary boşsa LLM taslağı için ham malzeme; en az biri dolu olmalı.
  goal: z.string().max(4_000).default(""),
  activity: z.array(z.string().min(1).max(2_000)).max(100).default([]),
  decisions: z.array(z.string().min(1).max(2_000)).max(20).default([]),
  nextStep: z.string().max(4_096).optional(),
  // Go gateway prompt cache için sohbet başına stabil kimlik; verilmezse
  // çağrı başına üretilir (önbellek çalışmaz ama istek geçerlidir).
  sessionId: z.string().min(1).max(128).optional(),
}).strict();

export type HandoffPrepareInput = z.infer<typeof handoffPrepareInputSchema>;

export interface HandoffPrepareResult {
  brief: string;
  bootstrap: string;
  truncated: boolean;
  llmDrafted: boolean;
}

function buildResult(summary: string, planSteps: HandoffPrepareInput["planSteps"], continuationToken: string, llmDrafted: boolean): HandoffPrepareResult {
  const notice = handoffPlanNotice(planSteps.map((step) => ({
    step: step.step,
    status: step.status,
    ...(step.details !== undefined ? { details: step.details } : {}),
  })));
  const full = `${summary}${notice}`;
  const bounded = boundBrief(full, MAX_HANDOFF_SUMMARY_CHARS);
  const bootstrap = resumeBootstrapText(bounded.brief, continuationToken);
  const bootstrapBounded = bootstrap.length > MAX_BOOTSTRAP_CHARS
    ? { text: bootstrap.slice(0, MAX_BOOTSTRAP_CHARS), truncated: true }
    : { text: bootstrap, truncated: false };
  return {
    brief: bounded.brief,
    bootstrap: bootstrapBounded.text,
    truncated: bounded.truncated || bootstrapBounded.truncated,
    llmDrafted,
  };
}

// Orkestrasyon: summary verilmişse aynen taşınır (eski davranış, birebir).
// summary boşsa ham malzemeden OpenCode Go ile taslak yazdırılır; LLM yoksa
// ya da çağrı başarısızsa sessizce uydurmak yerine açık hata dönülür:
// kural motoru özet yazamaz, uydurma brif taşınamaz.
export async function prepareHandoff(runtime: HandoffToolRuntime | undefined, input: HandoffPrepareInput): Promise<HandoffPrepareResult> {
  if (input.summary !== "") {
    return buildResult(input.summary, input.planSteps, input.continuationToken, false);
  }
  const hasMaterial =
    input.goal !== "" || input.activity.length > 0 || input.planSteps.length > 0 || input.decisions.length > 0;
  if (!hasMaterial) {
    throw new PolicyError("Özet yazılamadı: summary boş ve taslak için ham malzeme yok; summary alanını doldur ya da goal/activity/planSteps/decisions ver.");
  }
  const llm = runtime?.config.goal.llm;
  if (llm === undefined) {
    throw new PolicyError("Özet yazılamadı: LLM yapılandırması yok; summary alanını doldur ya da goal LLM yapılandırmasını aç.");
  }
  let apiKey: string;
  try {
    apiKey = await readOpencodeGoApiKey(runtime?.opencodeAuthPath ?? defaultOpencodeAuthPath());
  } catch {
    throw new PolicyError("Özet yazılamadı: OpenCode Go anahtarı okunamadı; summary alanını doldur ya da /connect ile giriş yap.");
  }
  let draft: string;
  try {
    draft = await draftBriefWithLlm(
      llm,
      {
        apiKey,
        sessionId: input.sessionId ?? `handoff-${randomUUID()}`,
        goal: input.goal,
        activity: [...input.activity],
        planSteps: input.planSteps.map((step) => ({
          step: step.step,
          status: step.status,
          ...(step.details !== undefined ? { details: step.details } : {}),
        })),
        decisions: [...input.decisions],
        nextStep: input.nextStep ?? null,
      },
      runtime?.goalLlmFetch ?? fetch,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "handoff_prepare.llm_failed",
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new PolicyError("Özet yazılamadı: LLM taslağı üretilemedi; summary alanını doldurup tekrar dene.");
  }
  return buildResult(draft, input.planSteps, input.continuationToken, true);
}

export function registerHandoffTool(server: McpServer, runtime?: HandoffToolRuntime): void {
  server.registerTool(
    "handoff_prepare",
    {
      description: "Build the compact handoff brief for the current work plus the exact replacement opening message. Pass summary to carry it over verbatim (center-trimmed with TASK/NEXT preserved), or omit summary and pass goal/activity/planSteps/decisions for an OpenCode Go drafted brief (llmDrafted true). Without summary and without LLM, the call fails closed: it never invents a brief. Persist with project_checkpoint (brief/planSteps/activity). No lease required.",
      inputSchema: handoffPrepareInputSchema,
      outputSchema: handoffPrepareOutputSchema,
      annotations,
    },
    async (input) => safeCall(async () => prepareHandoff(runtime, input)),
  );
}
