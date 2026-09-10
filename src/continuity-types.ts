import { z } from "zod";

export const continuityTaskSchema = z.object({
  goal: z.string().min(1),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  status: z.enum(["active", "blocked", "completed"]),
  nextStep: z.string().min(1),
  detail: z.string().optional(),
}).strict();

export const continuityDecisionSchema = z.object({
  decision: z.string().min(1),
  rationale: z.string().min(1),
  alternatives: z.array(z.string()),
  evidence: z.array(z.string()),
  validWhile: z.string().optional(),
}).strict();

export const continuitySemanticRecordSchema = z.object({
  recordVersion: z.number().int().positive(),
  task: continuityTaskSchema,
  decisions: z.array(continuityDecisionSchema),
  uncertainties: z.array(z.string()),
  verificationSummary: z.array(z.string()),
  createdAt: z.string(),
}).strict();

export const storedWorktreeIdentitySchema = z.object({
  canonicalPath: z.string().min(1),
  repositoryRoot: z.string().min(1),
  commonGitDir: z.string().min(1),
  gitDir: z.string().min(1),
  repositoryIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  worktreeIdentity: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const continuityLocalStateSchema = z.object({
  checkedAt: z.string(),
  branch: z.string().nullable(),
  headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  stagedPaths: z.array(z.string()),
  unstagedPaths: z.array(z.string()),
  untrackedPaths: z.array(z.string()),
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
  semantic: Omit<ContinuitySemanticRecord, "recordVersion" | "createdAt">;
}

export interface CheckpointProjectRecord {
  projectId: string;
  expectedRecordVersion: number;
  semantic: Omit<ContinuitySemanticRecord, "recordVersion" | "createdAt">;
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
