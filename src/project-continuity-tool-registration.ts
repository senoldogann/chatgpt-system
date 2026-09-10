import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "./errors.js";
import {
  projectContinuityResultOutputSchema,
  projectResumeOutputSchema,
} from "./continuity-output-schemas.js";
import type {
  ProjectCheckpointInput,
  ProjectContinuityResult,
  ProjectContinuityService,
  ProjectRegisterInput,
  ProjectResumeInput,
  ProjectResumeResult,
} from "./project-continuity-service.js";

const aliasSchema = z.string().trim().min(1).max(128);
const pathSchema = z.string().min(1).max(16_384);
const authorityLeaseSchema = z.string().min(40).max(256);
const semanticLineSchema = z.string().min(1).max(2_000);

export const projectTaskInputSchema = z.object({
  goal: z.string().min(1).max(8_000),
  constraints: z.array(semanticLineSchema).max(32),
  successCriteria: z.array(semanticLineSchema).max(32),
  status: z.enum(["active", "blocked", "completed"]),
  nextStep: z.string().min(1).max(4_000),
  detail: z.string().max(32_000).optional(),
}).strict();

export const projectDecisionInputSchema = z.object({
  decision: z.string().min(1).max(4_000),
  rationale: z.string().min(1).max(8_000),
  alternatives: z.array(semanticLineSchema).max(12),
  evidence: z.array(semanticLineSchema).max(20),
  validWhile: z.string().max(4_000).optional(),
}).strict();

const uncertaintySchema = z.array(semanticLineSchema).max(20).optional();
const verificationSummarySchema = z.array(semanticLineSchema).max(20).optional();
const decisionsSchema = z.array(projectDecisionInputSchema).max(20);

export const projectRegisterInputSchema = z.object({
  alias: aliasSchema,
  worktreePath: pathSchema,
  projectRoots: z.array(pathSchema).min(1).max(16),
  task: projectTaskInputSchema,
  decisions: decisionsSchema.optional(),
  uncertainties: uncertaintySchema,
  verificationSummary: verificationSummarySchema,
}).strict();

export const projectResumeInputSchema = z.object({
  alias: aliasSchema,
  requestedTtlSeconds: z.number().int().positive().max(8 * 60 * 60).optional(),
}).strict();

export const projectCheckpointInputSchema = z.object({
  authorityLeaseId: authorityLeaseSchema,
  alias: aliasSchema,
  expectedRecordVersion: z.number().int().positive(),
  task: projectTaskInputSchema,
  decisions: decisionsSchema,
  uncertainties: uncertaintySchema,
  verificationSummary: verificationSummarySchema,
}).strict();

export const projectContextReadInputSchema = z.object({
  authorityLeaseId: authorityLeaseSchema,
  alias: aliasSchema,
}).strict();

export interface ProjectContinuityToolRuntime {
  continuity: Pick<ProjectContinuityService, "register" | "resume" | "checkpoint" | "contextRead">;
}

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const readAnnotations = {
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

function safeErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { error: error.code, message: error.message };
  return { error: "INTERNAL_ERROR", message: "Project continuity operation failed." };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(safeErrorPayload(error)), isError: true };
  }
}

function publicContinuityResult(value: ProjectContinuityResult) {
  return {
    projectId: value.projectId,
    alias: value.alias,
    recordVersion: value.recordVersion,
    worktree: {
      canonicalPath: value.worktree.canonicalPath,
      repositoryRoot: value.worktree.repositoryRoot,
      repositoryIdentity: value.worktree.repositoryIdentity,
      worktreeIdentity: value.worktree.worktreeIdentity,
    },
    localState: value.localState,
    publishedState: value.publishedState,
    currentRecord: value.currentRecord,
  };
}

function publicResumeResult(value: ProjectResumeResult) {
  return {
    projectId: value.projectId,
    alias: value.alias,
    recordVersion: value.recordVersion,
    authorityLease: value.authorityLease,
    resumePackage: value.resumePackage,
    packageTruncated: value.packageTruncated,
    contextAvailable: value.contextAvailable,
  };
}

export function registerProjectContinuityTools(
  server: McpServer,
  runtime: ProjectContinuityToolRuntime,
): void {
  server.registerTool(
    "project_register",
    {
      description: "Register one exact project alias, Project roots, worktree identity, current goal, decisions, and next step for continuity. Registration does not create an authority lease and never fuzzy-matches aliases.",
      inputSchema: projectRegisterInputSchema,
      outputSchema: projectContinuityResultOutputSchema,
      annotations: mutationAnnotations,
    },
    async (input) => safeCall(async () => publicContinuityResult(
      await runtime.continuity.register(input as ProjectRegisterInput),
    )),
  );

  server.registerTool(
    "project_resume",
    {
      description: "Use when the user asks to continue a registered project by its exact alias in a new or current chat. Never fuzzy-match the alias. Revalidates the exact worktree and returns a fresh Project authority lease plus bounded resume context.",
      inputSchema: projectResumeInputSchema,
      outputSchema: projectResumeOutputSchema,
      annotations: mutationAnnotations,
    },
    async (input) => safeCall(async () => publicResumeResult(
      await runtime.continuity.resume(input as ProjectResumeInput),
    )),
  );

  server.registerTool(
    "project_checkpoint",
    {
      description: "Update the current project continuity record after user direction changes, important decisions, milestones or failures, and before a project handoff or final response. Delivery 1 is not automatically logged, so checkpoints must be written deliberately.",
      inputSchema: projectCheckpointInputSchema,
      outputSchema: projectContinuityResultOutputSchema,
      annotations: mutationAnnotations,
    },
    async (input) => safeCall(async () => publicContinuityResult(
      await runtime.continuity.checkpoint(input as ProjectCheckpointInput),
    )),
  );

  server.registerTool(
    "project_context_read",
    {
      description: "Read only the current semantic continuity record for the exact registered project. Use when project_resume reports truncated current critical context or when the full current semantic record is required. Delivery 1 has no historical-version selector.",
      inputSchema: projectContextReadInputSchema,
      outputSchema: projectContinuityResultOutputSchema,
      annotations: readAnnotations,
    },
    async (input) => safeCall(async () => publicContinuityResult(
      await runtime.continuity.contextRead(input),
    )),
  );
}
