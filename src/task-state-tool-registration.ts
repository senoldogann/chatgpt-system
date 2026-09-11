import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { errorPayload, VerificationRequiredError } from "./errors.js";
import { PathPolicy } from "./policy.js";
import { ProjectCheckService } from "./project-check-service.js";
import { ProjectExecService } from "./project-exec-service.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import { TaskStateService } from "./task-state-service.js";
import { taskStateOutputSchema } from "./tool-output-schemas.js";

export interface TaskStateToolRuntime {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  projectExecBackend: ProjectExecBackend;
  taskStateRoot: string;
}

const taskStateAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const baseFields = {
  authorityLeaseId: z.string().min(40),
  cwd: z.string().default("."),
};

const taskStateInputSchema = z.discriminatedUnion("operation", [
  z.object({
    ...baseFields,
    operation: z.literal("start"),
    goal: z.string().min(1).max(8_192),
    nextStep: z.string().min(1).max(4_096).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("checkpoint"),
    taskId: z.string().uuid(),
    summary: z.string().min(1).max(4_096),
    findings: z.array(z.string().min(1).max(2_048)).max(20).optional(),
    decisions: z.array(z.string().min(1).max(2_048)).max(20).optional(),
    inspectedFiles: z.array(z.string().min(1).max(8_192)).max(100).optional(),
    modifiedFiles: z.array(z.string().min(1).max(8_192)).max(100).optional(),
    nextStep: z.string().min(1).max(4_096).optional(),
    evidenceRefs: z.array(z.string().min(1).max(512)).max(50).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("status"),
    taskId: z.string().uuid(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("complete"),
    taskId: z.string().uuid(),
    summary: z.string().min(1).max(4_096),
    evidenceRefs: z.array(z.string().min(1).max(512)).max(50).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("fail"),
    taskId: z.string().uuid(),
    summary: z.string().min(1).max(4_096),
    evidenceRefs: z.array(z.string().min(1).max(512)).max(50).optional(),
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

function taskContextFor(runtime: TaskStateToolRuntime, authorityLeaseId: string) {
  const authority = runtime.authority.resolve(authorityLeaseId);
  const policy = new PathPolicy([...authority.roots]);
  return {
    authority,
    policy,
    taskState: new TaskStateService(
      policy,
      runtime.audit,
      runtime.taskStateRoot,
      authority.profile,
      runtime.config.limits,
    ),
  };
}

export function registerTaskStateTool(server: McpServer, runtime: TaskStateToolRuntime): void {
  server.registerTool(
    "task_state",
    {
      description: "Persist bounded Project-scoped engineering task state and checkpoints under the dedicated local state subtree. Freshness is bound to repository HEAD and current working-tree content.",
      inputSchema: taskStateInputSchema,
      outputSchema: taskStateOutputSchema,
      annotations: taskStateAnnotations,
    },
    async (input) => safeCall(async () => {
      const { authority, policy, taskState } = taskContextFor(runtime, input.authorityLeaseId);
      if (input.operation === "start") {
        return taskState.start(input.goal, input.cwd, input.nextStep);
      }
      if (input.operation === "checkpoint") {
        return taskState.checkpoint(input.taskId, {
          summary: input.summary,
          ...(input.findings !== undefined ? { findings: input.findings } : {}),
          ...(input.decisions !== undefined ? { decisions: input.decisions } : {}),
          ...(input.inspectedFiles !== undefined ? { inspectedFiles: input.inspectedFiles } : {}),
          ...(input.modifiedFiles !== undefined ? { modifiedFiles: input.modifiedFiles } : {}),
          ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
          ...(input.evidenceRefs !== undefined ? { evidenceRefs: input.evidenceRefs } : {}),
        }, input.cwd);
      }
      if (input.operation === "status") {
        return taskState.status(input.taskId, input.cwd);
      }
      if (input.operation === "complete") {
        const projectExec = new ProjectExecService(
          policy,
          runtime.audit,
          runtime.projectExecBackend,
          runtime.config.projectExec.enabled,
          authority.profile,
          [...runtime.config.terminal.commands],
          runtime.config.limits,
        );
        const verification = await new ProjectCheckService(
          policy,
          runtime.audit,
          runtime.taskStateRoot,
          authority.profile,
          runtime.config.limits,
          projectExec,
        ).report(input.cwd);
        if (verification.required && verification.overallStatus !== "PASS") {
          throw new VerificationRequiredError(verification.overallStatus);
        }
        return taskState.complete(input.taskId, input.summary, input.evidenceRefs, input.cwd);
      }
      return taskState.fail(input.taskId, input.summary, input.evidenceRefs, input.cwd);
    }),
  );
}
