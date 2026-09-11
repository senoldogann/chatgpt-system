import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const gitObjectIdSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

export const continuityPublicWorktreeSchema = z.object({
  canonicalPath: z.string(),
  repositoryRoot: z.string(),
  repositoryIdentity: sha256Schema,
  worktreeIdentity: sha256Schema,
}).strict();

export const continuityLocalStateOutputSchema = z.object({
  checkedAt: z.string(),
  branch: z.string().nullable(),
  headSha: gitObjectIdSchema,
  stagedPaths: z.array(z.string()),
  unstagedPaths: z.array(z.string()),
  untrackedPaths: z.array(z.string()),
  pathsTruncated: z.boolean(),
}).strict();

export const continuityRemoteRefOutputSchema = z.object({
  status: z.enum(["verified", "not_found", "unverified"]),
  ref: z.string().nullable(),
  currentSha: gitObjectIdSchema.optional(),
  checkedAt: z.string(),
  lastVerifiedSha: gitObjectIdSchema.optional(),
  lastVerifiedAt: z.string().optional(),
  reason: z.enum(["detached_head", "remote_missing", "remote_error"]).optional(),
}).strict();

export const continuityPublishedStateOutputSchema = z.object({
  remoteName: z.literal("origin").nullable(),
  branch: continuityRemoteRefOutputSchema,
  main: continuityRemoteRefOutputSchema,
}).strict();

export const continuityTaskOutputSchema = z.object({
  goal: z.string(),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  status: z.enum(["active", "blocked", "completed"]),
  nextStep: z.string(),
  detail: z.string().optional(),
}).strict();

export const continuityDecisionOutputSchema = z.object({
  decision: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()),
  evidence: z.array(z.string()),
  validWhile: z.string().optional(),
}).strict();

export const continuitySemanticRecordOutputSchema = z.object({
  recordVersion: z.number().int().positive(),
  task: continuityTaskOutputSchema,
  decisions: z.array(continuityDecisionOutputSchema),
  uncertainties: z.array(z.string()),
  verificationSummary: z.array(z.string()),
  createdAt: z.string(),
}).strict();

export const projectContinuityResultOutputSchema = z.object({
  projectId: z.string(),
  alias: z.string(),
  recordVersion: z.number().int().positive(),
  worktree: continuityPublicWorktreeSchema,
  localState: continuityLocalStateOutputSchema,
  publishedState: continuityPublishedStateOutputSchema,
  currentRecord: continuitySemanticRecordOutputSchema,
}).strict();

export const projectResumeOutputSchema = z.object({
  projectId: z.string(),
  alias: z.string(),
  recordVersion: z.number().int().positive(),
  authorityLease: z.object({
    leaseId: z.string().min(40),
    profile: z.literal("project"),
    roots: z.array(z.string()),
    terminalEnabled: z.literal(false),
    commands: z.array(z.string()),
    createdAt: z.string(),
    expiresAt: z.string(),
  }).strict(),
  resumePackage: z.string(),
  packageTruncated: z.boolean(),
  contextAvailable: z.boolean(),
}).strict();
