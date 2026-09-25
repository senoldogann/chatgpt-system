import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuditLogger } from "../core/audit.js";
import type { AppConfig } from "../core/config.js";
import { AppError } from "../core/errors.js";
import { assertWorkerAliasLive } from "../agent/worker-store.js";
import {
  projectContinuityResultOutputSchema,
  projectListOutputSchema,
  projectResumeOutputSchema,
} from "./continuity-output-schemas.js";
import {
  CONTINUITY_MAX_DECISIONS,
  CONTINUITY_MAX_PROJECT_ROOTS,
  CONTINUITY_MAX_UNCERTAINTIES,
  CONTINUITY_MAX_VERIFICATION_SUMMARY,
  continuityAliasSchema,
  continuityDecisionSchema,
  continuityPathSchema,
  continuitySemanticLineSchema,
  continuityTaskSchema,
} from "./continuity-types.js";
import type {
  ProjectCheckpointInput,
  ProjectContinuityResult,
  ProjectContinuityService,
  ProjectRegisterInput,
  ProjectResumeInput,
  ProjectResumeResult,
} from "./project-continuity-service.js";
import { createSafeCall } from "../mcp/tool-result.js";
import { READ_ONLY, WRITE_OPEN_WORLD } from "../mcp/tool-annotations.js";

const authorityLeaseSchema = z.string().min(40).max(256);

export const projectTaskInputSchema = continuityTaskSchema;
export const projectDecisionInputSchema = continuityDecisionSchema;

const uncertaintySchema = z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_UNCERTAINTIES).optional();
const verificationSummarySchema = z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_VERIFICATION_SUMMARY).optional();
const decisionsSchema = z.array(projectDecisionInputSchema).max(CONTINUITY_MAX_DECISIONS);

export const projectRegisterInputSchema = z.object({
  alias: continuityAliasSchema,
  worktreePath: continuityPathSchema,
  projectRoots: z.array(continuityPathSchema).min(1).max(CONTINUITY_MAX_PROJECT_ROOTS),
  task: projectTaskInputSchema,
  decisions: decisionsSchema.optional(),
  uncertainties: uncertaintySchema,
  verificationSummary: verificationSummarySchema,
}).strict();

export const projectResumeInputSchema = z.object({
  alias: continuityAliasSchema,
  requestedTtlSeconds: z.number().int().positive().max(8 * 60 * 60).optional(),
}).strict();

export const projectCheckpointInputSchema = z.object({
  authorityLeaseId: authorityLeaseSchema,
  alias: continuityAliasSchema,
  expectedRecordVersion: z.number().int().positive(),
  task: projectTaskInputSchema,
  decisions: decisionsSchema,
  uncertainties: uncertaintySchema,
  verificationSummary: verificationSummarySchema,
}).strict();

export const projectContextReadInputSchema = z.object({
  authorityLeaseId: authorityLeaseSchema,
  alias: continuityAliasSchema,
}).strict();

export interface ProjectContinuityToolRuntime {
  continuity: Pick<ProjectContinuityService, "register" | "resume" | "checkpoint" | "contextRead" | "listProjects">;
  audit: AuditLogger;
  config: AppConfig;
  taskStateRoot: string;
}

async function assertAliasLive(runtime: ProjectContinuityToolRuntime, alias: string): Promise<void> {
  await assertWorkerAliasLive(
    {
      taskStateRoot: runtime.taskStateRoot,
      audit: runtime.audit,
      maxWorkers: runtime.config.workers.maxWorkers,
      maxParkedRuns: runtime.config.workers.maxParkedRuns,
    },
    alias,
  );
}

function safeErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { error: error.code, message: error.message };
  return { error: "INTERNAL_ERROR", message: "Project continuity operation failed." };
}

const safeCall = createSafeCall(safeErrorPayload);

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
      annotations: WRITE_OPEN_WORLD,
    },
    async (input) => safeCall(async () => publicContinuityResult(
      await runtime.continuity.register(input as ProjectRegisterInput),
    )),
  );

  server.registerTool(
    "project_resume",
    {
      description: "Use when the user asks to continue a registered project by its exact alias in a new or current chat. Never fuzzy-match the alias; when the alias is unknown, call project_list first. After developer MCP capability returns in a new or recovered chat, call project_resume before any project mutation. Revalidates the exact worktree and returns a fresh Project authority lease plus bounded resume context.",
      inputSchema: projectResumeInputSchema,
      outputSchema: projectResumeOutputSchema,
      annotations: WRITE_OPEN_WORLD,
    },
    async (input) => safeCall(async () => publicResumeResult(
      await runtime.continuity.resume(input as ProjectResumeInput),
    )),
  );

  server.registerTool(
    "project_checkpoint",
    {
      description: "Update Project Continuity only for important decisions, changed blockers, verified delivery, ownership transfer or final handoff. A risk checkpoint is appropriate before an exceptional irreversible transition where developer MCP capability could disappear between messages. Do not checkpoint automatically for long commands, tool counts, repeated checks or every final response; consolidate unchanged milestones. Delivery 1 is not automatically logged.",
      inputSchema: projectCheckpointInputSchema,
      outputSchema: projectContinuityResultOutputSchema,
      annotations: WRITE_OPEN_WORLD,
    },
    async (input) => safeCall(async () => {
      await assertAliasLive(runtime, input.alias);
      return publicContinuityResult(
        await runtime.continuity.checkpoint(input as ProjectCheckpointInput),
      );
    }),
  );

  server.registerTool(
    "project_context_read",
    {
      description: "Read only the current semantic continuity record for the exact registered project. Use when project_resume reports truncated current critical context or when the full current semantic record is required. Delivery 1 has no historical-version selector.",
      inputSchema: projectContextReadInputSchema,
      outputSchema: projectContinuityResultOutputSchema,
      annotations: READ_ONLY,
    },
    async (input) => safeCall(async () => publicContinuityResult(
      await runtime.continuity.contextRead(input),
    )),
  );

  server.registerTool(
    "project_list",
    {
      description: "List all registered project aliases with their roots, record versions, and worktree paths. Use first when the user wants to work on a project but the exact alias is unknown. Never fuzzy-match; resume the chosen alias exactly.",
      inputSchema: z.object({}).strict(),
      outputSchema: projectListOutputSchema,
      annotations: READ_ONLY,
    },
    async () => safeCall(async () => runtime.continuity.listProjects()),
  );
}
