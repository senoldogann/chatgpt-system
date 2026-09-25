import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  createProjectCheckHostExecutorFactory,
  createProjectCheckService,
  createProjectCheckServiceForRoots,
  type ProjectCheckRuntimeDependencies,
} from "./project-check-factory.js";
import { projectCheckOutputSchema } from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";

export interface ProjectCheckToolRuntime extends ProjectCheckRuntimeDependencies {}

const annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const baseFields = {
  authorityLeaseId: z.string().min(40).optional(),
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
    adminAuthorityLeaseId: z.string().min(40).optional(),
    checkIds: z.array(z.string().min(1).max(256)).min(1).max(32).optional(),
    timeoutMs: z.number().int().positive().max(600_000).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("report"),
  }).strict(),
]);

export function registerProjectCheckTool(server: McpServer, runtime: ProjectCheckToolRuntime): void {
  server.registerTool(
    "project_check",
    {
      description: "Detect repository-defined verification checks, run only detected checks through their declared Project-sandbox or explicitly enabled native-host lane, and report freshness-bound evidence without persisting raw command output.",
      inputSchema,
      outputSchema: projectCheckOutputSchema,
      annotations,
    },
    async (input) => safeCall(async () => {
      const service = input.authorityLeaseId === undefined
        ? createProjectCheckServiceForRoots(runtime, runtime.config.roots)
        : createProjectCheckService(runtime, input.authorityLeaseId);
      if (input.operation === "detect") return service.detect(input.cwd);
      if (input.operation === "report") return service.report(input.cwd);
      const hostExecutorFactory = input.adminAuthorityLeaseId === undefined
        ? undefined
        : createProjectCheckHostExecutorFactory(runtime, input.adminAuthorityLeaseId);
      return service.run(input.cwd, input.checkIds, input.timeoutMs, hostExecutorFactory);
    }),
  );
}
