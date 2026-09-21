import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { errorPayload } from "./errors.js";
import { boundBrief, handoffPlanNotice, resumeBootstrapText } from "./handoff.js";
import { handoffPrepareOutputSchema } from "./tool-output-schemas.js";

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

const MAX_HANDOFF_SUMMARY_CHARS = 8_000;
const MAX_BOOTSTRAP_CHARS = 12_000;

const planStepSchema = z.object({
  step: z.string().min(1).max(2_000),
  status: z.string().min(1).max(64),
  details: z.string().max(4_000).optional(),
}).strict();

export function registerHandoffTool(server: McpServer): void {
  server.registerTool(
    "handoff_prepare",
    {
      description: "Build the compact handoff brief for the current work plus the exact replacement opening message. The brief is the previous chat's own summary; carry it over rather than starting again. Long briefs are center-trimmed with TASK/NEXT preserved. Persist with project_checkpoint (brief/planSteps/activity). No lease required.",
      inputSchema: z.object({
        summary: z.string().min(1).max(MAX_HANDOFF_SUMMARY_CHARS),
        planSteps: z.array(planStepSchema).max(20).default([]),
        continuationToken: z.string().max(256).default(""),
      }).strict(),
      outputSchema: handoffPrepareOutputSchema,
      annotations,
    },
    async ({ summary, planSteps, continuationToken }) => safeCall(async () => {
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
      };
    }),
  );
}
