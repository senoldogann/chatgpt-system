import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { errorPayload } from "./errors.js";
import { decideGoal } from "./goal-service.js";
import { goalAdviseOutputSchema } from "./tool-output-schemas.js";

export interface GoalToolRuntime {
  config: {
    goal: {
      enabled: boolean;
      maxTranscriptChars: number;
    };
  };
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function successResult<T extends object>(value: T) {
  return {
    ...textResult(value),
    structuredContent: value as Record<string, unknown>,
  };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(errorPayload(error)), isError: true };
  }
}

const planStepSchema = z.object({
  step: z.string().min(1).max(2_048),
  status: z.string().min(1).max(64),
  details: z.string().max(4_096).optional(),
}).strict();

export function registerGoalTool(server: McpServer, runtime: GoalToolRuntime): void {
  server.registerTool(
    "goal_advise",
    {
      description: "Decide whether the whole requested job is clearly complete and, while it is not, draft the exact next instruction covering the largest coherent remaining work. Manual only: it never sends anything and Loop mode does not exist. No lease required.",
      inputSchema: z.object({
        objective: z.string().max(8_192).default(""),
        transcriptTail: z.string().max(120_000).default(""),
        planSteps: z.array(planStepSchema).max(100).default([]),
        successCriteria: z.array(z.string().min(1).max(2_048)).max(20).default([]),
        nextStep: z.string().max(4_096).optional(),
      }).strict(),
      outputSchema: goalAdviseOutputSchema,
      annotations,
    },
    async (input) => safeCall(async () => {
      const maxTranscript = runtime.config.goal.maxTranscriptChars;
      const transcriptTail = input.transcriptTail.length > maxTranscript
        ? input.transcriptTail.slice(input.transcriptTail.length - maxTranscript)
        : input.transcriptTail;
      return decideGoal({
        objective: input.objective,
        transcriptTail,
        planSteps: input.planSteps.map((step) => ({
          step: step.step,
          status: step.status,
          ...(step.details !== undefined ? { details: step.details } : {}),
        })),
        successCriteria: [...input.successCriteria],
        ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
      });
    }),
  );
}
