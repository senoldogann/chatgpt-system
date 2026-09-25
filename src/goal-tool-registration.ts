import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GoalLlmConfig } from "./config.js";
import { adviseWithLlm, type FetchImpl } from "./goal-llm.js";
import { decideGoal, type GoalAdvice } from "./goal-service.js";
import { defaultOpencodeAuthPath, readOpencodeGoApiKey } from "./opencode-auth.js";
import { goalAdviseOutputSchema } from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";

export interface GoalToolRuntime {
  config: {
    goal: {
      enabled: boolean;
      maxTranscriptChars: number;
      llm?: GoalLlmConfig;
    };
  };
  // Testlerde gerçek ağa çıkılmasın diye enjekte edilir; üretimde global fetch.
  goalLlmFetch?: FetchImpl;
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

const planStepSchema = z.object({
  step: z.string().min(1).max(2_048),
  status: z.string().min(1).max(64),
  details: z.string().max(4_096).optional(),
}).strict();

const goalAdviseInputSchema = z.object({
  objective: z.string().max(8_192).default(""),
  transcriptTail: z.string().max(120_000).default(""),
  planSteps: z.array(planStepSchema).max(100).default([]),
  successCriteria: z.array(z.string().min(1).max(2_048)).max(20).default([]),
  nextStep: z.string().max(4_096).optional(),
  // Go gateway prompt cache için sohbet başına stabil kimlik; verilmezse
  // çağrı başına üretilir (önbellek çalışmaz ama istek geçerlidir).
  sessionId: z.string().min(1).max(128).optional(),
}).strict();

export type GoalAdviseInput = z.infer<typeof goalAdviseInputSchema>;

// Orkestrasyon: LLM anahtarı ve yapılandırması varsa OpenCode Go'ya sor,
// her türlü arızada kural motoruna düş (açık fallback, sessiz değil:
// reason hangi yolun kullanıldığını söyler).
export async function adviseGoal(runtime: GoalToolRuntime, input: GoalAdviseInput): Promise<GoalAdvice> {
  const maxTranscript = runtime.config.goal.maxTranscriptChars;
  const transcriptTail =
    input.transcriptTail.length > maxTranscript
      ? input.transcriptTail.slice(input.transcriptTail.length - maxTranscript)
      : input.transcriptTail;
  const planSteps = input.planSteps.map((step) => ({
    step: step.step,
    status: step.status,
    ...(step.details !== undefined ? { details: step.details } : {}),
  }));
  const ruleAdvice = (): GoalAdvice => {
    const advice = decideGoal({
      objective: input.objective,
      transcriptTail,
      planSteps,
      successCriteria: [...input.successCriteria],
      ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
    });
    return advice;
  };
  const llm = runtime.config.goal.llm;
  if (llm === undefined) return ruleAdvice();
  let apiKey: string;
  try {
    apiKey = await readOpencodeGoApiKey(runtime.opencodeAuthPath ?? defaultOpencodeAuthPath());
  } catch (error) {
    const rule = ruleAdvice();
    return {
      ...rule,
      reason: `${rule.reason} (OpenCode Go anahtarı okunamadı, kural motoru kullanıldı.)`,
    };
  }
  try {
    return await adviseWithLlm(
      llm,
      {
        apiKey,
        sessionId: input.sessionId ?? `goal-${randomUUID()}`,
        objective: input.objective,
        transcriptTail,
        planSteps,
        successCriteria: [...input.successCriteria],
        nextStep: input.nextStep ?? null,
      },
      runtime.goalLlmFetch ?? fetch,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "goal_advise.llm_fallback",
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    const rule = ruleAdvice();
    return { ...rule, reason: `${rule.reason} (LLM kullanılamadı, kural motoru kullanıldı.)` };
  }
}

export function registerGoalTool(server: McpServer, runtime: GoalToolRuntime): void {
  server.registerTool(
    "goal_advise",
    {
      description:
        "Decide whether the whole requested job is clearly complete and, while it is not, draft the exact next instruction covering the largest coherent remaining work. OpenCode Go key present: the supplied goal and transcript are sent to the OpenCode Go API for an LLM-backed decision; otherwise rule-based fallback (reason names the path). Manual only: it never posts chat messages and Loop mode does not exist. No lease required.",
      inputSchema: goalAdviseInputSchema,
      outputSchema: goalAdviseOutputSchema,
      annotations,
    },
    async (input) => safeCall(async () => adviseGoal(runtime, input)),
  );
}
