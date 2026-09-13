import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { errorPayload } from "./errors.js";
import { createProjectCheckService, type ProjectCheckRuntimeDependencies } from "./project-check-factory.js";
import { projectCheckOutputSchema } from "./tool-output-schemas.js";

export interface ProjectCheckToolRuntime extends ProjectCheckRuntimeDependencies {}

const annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const baseFields = {
  authorityLeaseId: z.string().min(40),
  cwd: z.string().default("."),
};

const inputSchema = z.discriminatedUnion("operation", [
  z.object({
    ...baseFields,
    operation: z.literal("detect"),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("run"),
    checkIds: z.array(z.string().min(1).max(256)).min(1).max(32).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("report"),
  }).strict(),
]);

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

export function registerProjectCheckTool(server: McpServer, runtime: ProjectCheckToolRuntime): void {
  server.registerTool(
    "project_check",
    {
      description: "Detect repository-defined verification checks, run only detected checks inside the existing Project sandbox, and report freshness-bound evidence without persisting raw command output.",
      inputSchema,
      outputSchema: projectCheckOutputSchema,
      annotations,
    },
    async (input) => safeCall(async () => {
      const service = createProjectCheckService(runtime, input.authorityLeaseId);
      if (input.operation === "detect") return service.detect(input.cwd);
      if (input.operation === "report") return service.report(input.cwd);
      return service.run(input.cwd, input.checkIds, input.timeoutMs);
    }),
  );
}
