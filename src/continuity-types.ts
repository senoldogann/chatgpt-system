import { z } from "zod";

export const CONTINUITY_MAX_ALIAS_CHARS = 128;
export const CONTINUITY_MAX_PATH_CHARS = 16_384;
export const CONTINUITY_MAX_PROJECT_ROOTS = 16;
export const CONTINUITY_MAX_TRACKED_PATHS = 100;
export const CONTINUITY_MAX_GOAL_CHARS = 8_000;
export const CONTINUITY_MAX_SEMANTIC_LINE_CHARS = 2_000;
export const CONTINUITY_MAX_CONSTRAINTS = 32;
export const CONTINUITY_MAX_SUCCESS_CRITERIA = 32;
export const CONTINUITY_MAX_NEXT_STEP_CHARS = 4_000;
export const CONTINUITY_MAX_DETAIL_CHARS = 32_000;
export const CONTINUITY_MAX_DECISIONS = 20;
export const CONTINUITY_MAX_DECISION_CHARS = 4_000;
export const CONTINUITY_MAX_RATIONALE_CHARS = 8_000;
export const CONTINUITY_MAX_ALTERNATIVES = 12;
export const CONTINUITY_MAX_EVIDENCE = 20;
export const CONTINUITY_MAX_VALID_WHILE_CHARS = 4_000;
export const CONTINUITY_MAX_UNCERTAINTIES = 20;
export const CONTINUITY_MAX_VERIFICATION_SUMMARY = 20;

export const continuityAliasSchema = z.string().trim().min(1).max(CONTINUITY_MAX_ALIAS_CHARS);
export const continuityPathSchema = z.string().min(1).max(CONTINUITY_MAX_PATH_CHARS);
export const continuityProjectRootsSchema = z.array(continuityPathSchema).min(1).max(CONTINUITY_MAX_PROJECT_ROOTS);
export const continuitySemanticLineSchema = z.string().min(1).max(CONTINUITY_MAX_SEMANTIC_LINE_CHARS);

export const continuityTaskSchema = z.object({
  goal: z.string().min(1).max(CONTINUITY_MAX_GOAL_CHARS),
  constraints: z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_CONSTRAINTS),
  successCriteria: z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_SUCCESS_CRITERIA),
  status: z.enum(["active", "blocked", "completed"]),
  nextStep: z.string().min(1).max(CONTINUITY_MAX_NEXT_STEP_CHARS),
  detail: z.string().max(CONTINUITY_MAX_DETAIL_CHARS).optional(),
}).strict();

export const continuityDecisionSchema = z.object({
  decision: z.string().min(1).max(CONTINUITY_MAX_DECISION_CHARS),
  rationale: z.string().min(1).max(CONTINUITY_MAX_RATIONALE_CHARS),
  alternatives: z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_ALTERNATIVES),
  evidence: z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_EVIDENCE),
  validWhile: z.string().max(CONTINUITY_MAX_VALID_WHILE_CHARS).optional(),
}).strict();

export const continuitySemanticInputSchema = z.object({
  task: continuityTaskSchema,
  decisions: z.array(continuityDecisionSchema).max(CONTINUITY_MAX_DECISIONS),
  uncertainties: z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_UNCERTAINTIES),
  verificationSummary: z.array(continuitySemanticLineSchema).max(CONTINUITY_MAX_VERIFICATION_SUMMARY),
}).strict();

export const continuitySemanticRecordSchema = continuitySemanticInputSchema.extend({
  recordVersion: z.number().int().positive(),
  createdAt: z.string(),
}).strict();

export const storedWorktreeIdentitySchema = z.object({
  canonicalPath: continuityPathSchema,
  repositoryRoot: continuityPathSchema,
  commonGitDir: continuityPathSchema,
  gitDir: continuityPathSchema,
  repositoryIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  worktreeIdentity: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const continuityLocalStateSchema = z.object({
  checkedAt: z.string(),
  branch: z.string().nullable(),
  headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  stagedPaths: z.array(continuityPathSchema).max(CONTINUITY_MAX_TRACKED_PATHS),
  unstagedPaths: z.array(continuityPathSchema).max(CONTINUITY_MAX_TRACKED_PATHS),
  untrackedPaths: z.array(continuityPathSchema).max(CONTINUITY_MAX_TRACKED_PATHS),
  pathsTruncated: z.boolean(),
}).strict();

export const remoteVerificationStatusSchema = z.enum(["verified", "not_found", "unverified"]);

export const remoteRefStateSchema = z.object({
  status: remoteVerificationStatusSchema,
  ref: z.string().nullable(),
  currentSha: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  checkedAt: z.string(),
  lastVerifiedSha: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  lastVerifiedAt: z.string().optional(),
  reason: z.enum(["detached_head", "remote_missing", "remote_error"]).optional(),
}).strict();

export const continuityPublishedStateSchema = z.object({
  remoteName: z.literal("origin").nullable(),
  branch: remoteRefStateSchema,
  main: remoteRefStateSchema,
}).strict();

export type ContinuityTask = z.infer<typeof continuityTaskSchema>;
export type ContinuityDecision = z.infer<typeof continuityDecisionSchema>;
export type ContinuitySemanticInput = z.infer<typeof continuitySemanticInputSchema>;
export type ContinuitySemanticRecord = z.infer<typeof continuitySemanticRecordSchema>;
export type StoredWorktreeIdentity = z.infer<typeof storedWorktreeIdentitySchema>;
export type ContinuityLocalState = z.infer<typeof continuityLocalStateSchema>;
export type RemoteVerificationStatus = z.infer<typeof remoteVerificationStatusSchema>;
export type RemoteRefState = z.infer<typeof remoteRefStateSchema>;
export type ContinuityPublishedState = z.infer<typeof continuityPublishedStateSchema>;

export interface RegisterProjectRecord {
  id: string;
  alias: string;
  roots: string[];
  worktree: StoredWorktreeIdentity;
  localState: ContinuityLocalState;
  publishedState: ContinuityPublishedState;
  semantic: ContinuitySemanticInput;
}

export interface CheckpointProjectRecord {
  projectId: string;
  expectedRecordVersion: number;
  semantic: ContinuitySemanticInput;
  localState: ContinuityLocalState;
  publishedState: ContinuityPublishedState;
  checkedAt: string;
}

export interface StoredProject {
  id: string;
  alias: string;
  aliasKey: string;
  roots: string[];
  worktree: StoredWorktreeIdentity;
  localState: ContinuityLocalState;
  publishedState: ContinuityPublishedState;
  currentRecord: ContinuitySemanticRecord;
  createdAt: string;
  updatedAt: string;
}

export type StoredProjectWithCurrentRecord = StoredProject;

export function continuityAliasKey(alias: string): string {
  return alias.trim().normalize("NFKC").toLowerCase();
}
