import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pathTypeSchema = z.enum(["directory", "file", "symlink", "other"]);
const nonNegativeInt = z.number().int().nonnegative();
const authorityProfileSchema = z.enum(["project", "user", "admin"]);
const authorityApprovalProfileSchema = z.enum(["user", "admin"]);
const authorityRequestStateSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "cancelled",
  "failed",
  "expired",
  "consumed",
]);

export const systemCapabilitiesOutputSchema = z.object({
  roots: z.array(z.string()),
  auditFile: z.string(),
  terminal: z.object({
    enabled: z.boolean(),
    commands: z.array(z.string()),
  }),
  limits: z.object({
    maxReadBytes: z.number().int().positive(),
    maxWriteBytes: z.number().int().positive(),
    maxDirectoryEntries: z.number().int().positive(),
    maxCommandOutputBytes: z.number().int().positive(),
    commandTimeoutMs: z.number().int().positive(),
  }),
  safety: z.object({
    filesystemConfinement: z.literal(true),
    symlinkEscapeProtection: z.literal(true),
    writeConflictProtection: z.literal("optimistic-sha256"),
    atomicFileReplacement: z.literal(true),
    linearizableExternalWriterCAS: z.literal(false),
    hostileLocalFilesystemRaceProtection: z.literal(false),
    terminalOsSandboxed: z.literal(false),
  }),
});

export const authorityLeaseOutputSchema = z.object({
  leaseId: z.string(),
  profile: authorityProfileSchema,
  roots: z.array(z.string()),
  terminalEnabled: z.boolean(),
  commands: z.array(z.string()),
  createdAt: z.string(),
  expiresAt: z.string(),
});

const authorityRequestBaseOutputSchema = z.object({
  requestId: z.string(),
  profile: authorityApprovalProfileSchema,
  state: authorityRequestStateSchema,
  requestedTtlSeconds: z.number().int().positive().optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const authorityRequestOutputSchema = authorityRequestBaseOutputSchema;

export const authorityRequestStatusOutputSchema = authorityRequestBaseOutputSchema.extend({
  lease: authorityLeaseOutputSchema.optional(),
});

export const authorityEndOutputSchema = z.object({
  ended: z.literal(true),
});

export const fsListOutputSchema = z.object({
  path: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    type: pathTypeSchema,
  })),
});

export const fsStatOutputSchema = z.object({
  path: z.string(),
  type: pathTypeSchema,
  size: nonNegativeInt,
  mode: z.string().regex(/^0[0-7]{1,3}$/),
  modifiedAt: z.string(),
  sha256: sha256Schema.optional(),
});

export const fsReadOutputSchema = z.object({
  path: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  bytes: nonNegativeInt,
  sha256: sha256Schema,
});

export const fsWriteOutputSchema = z.object({
  path: z.string(),
  bytes: nonNegativeInt,
  sha256: sha256Schema,
  created: z.boolean(),
});

export const fsPatchOutputSchema = z.object({
  path: z.string(),
  bytes: nonNegativeInt,
  sha256: sha256Schema,
});

export const fsMkdirOutputSchema = z.object({
  path: z.string(),
  created: z.boolean(),
});

export const fsMoveOutputSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const fsRemoveOutputSchema = z.object({
  path: z.string(),
  removed: z.literal(true),
});

export const gitResultOutputSchema = z.object({
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export const terminalResultOutputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
});
