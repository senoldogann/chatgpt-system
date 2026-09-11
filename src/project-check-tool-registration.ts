import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { errorPayload } from "./errors.js";
import { PathPolicy } from "./policy.js";
import { ProjectCheckService } from "./project-check-service.js";
import { ProjectExecService } from "./project-exec-service.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import { projectCheckOutputSchema } from "./tool-output-schemas.js";

export interface ProjectCheckToolRuntime {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  projectExecBackend: ProjectExecBackend;
  taskStateRoot: string;
}

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

function projectCheckFor(runtime: ProjectCheckToolRuntime, authorityLeaseId: string): ProjectCheckService {
  const authority = runtime.authority.resolve(authorityLeaseId);
  const policy = new PathPolicy([...authority.roots]);
  const projectExec = new ProjectExecService(
    policy,
    runtime.audit,
    runtime.projectExecBackend,
    runtime.config.projectExec.enabled,
    authority.profile,
    [...runtime.config.terminal.commands],
    runtime.config.limits,
  );
  return new ProjectCheckService(
    policy,
    runtime.audit,
    runtime.taskStateRoot,
    authority.profile,
    runtime.config.limits,
    projectExec,
  );
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
      const service = projectCheckFor(runtime, input.authorityLeaseId);
      if (input.operation === "detect") return service.detect(input.cwd);
      if (input.operation === "report") return service.report(input.cwd);
      return service.run(input.cwd, input.checkIds, input.timeoutMs);
    }),
  );
}
