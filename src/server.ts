import { McpServer } from "@modelcontextprotocol/server";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AuthorityManager } from "./authority.js";
import { AuthorityRequestManager } from "./authority-request-manager.js";
import type { AppConfig } from "./config.js";
import { AuditLogger } from "./audit.js";
import { FileSystemService } from "./fs-service.js";
import { GitService } from "./git-service.js";
import {
  MacOSLocalAuthorityBroker,
  type LocalAuthorityBroker,
  type LocalAuthorityOutcome,
} from "./local-authority-broker.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import { createScopedRuntime } from "./scoped-runtime.js";
import {
  LocalApprovalRequiredError,
  errorPayload,
} from "./errors.js";
import {
  authorityEndOutputSchema,
  authorityLeaseOutputSchema,
  authorityRequestOutputSchema,
  authorityRequestStatusOutputSchema,
  fsListOutputSchema,
  fsMkdirOutputSchema,
  fsMoveOutputSchema,
  fsPatchOutputSchema,
  fsReadOutputSchema,
  fsRemoveOutputSchema,
  fsStatOutputSchema,
  fsWriteOutputSchema,
  gitResultOutputSchema,
  systemCapabilitiesOutputSchema,
  terminalResultOutputSchema,
} from "./tool-output-schemas.js";

const DEFAULT_APPROVAL_HELPER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../native/macos-authority-broker/.build/release/chatgpt-system-authority-broker",
);

export interface RuntimeServices {
  config: AppConfig;
  policy: PathPolicy;
  audit: AuditLogger;
  authority: AuthorityManager;
  authorityRequests: AuthorityRequestManager;
  approvalBroker: LocalAuthorityBroker;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
}

export interface RuntimeOptions {
  approvalBroker?: LocalAuthorityBroker;
  authorityRequests?: AuthorityRequestManager;
}

export function createRuntimeServices(config: AppConfig, options: RuntimeOptions = {}): RuntimeServices {
  const policy = new PathPolicy(config.roots);
  const audit = new AuditLogger(config.auditFile);
  const authority = new AuthorityManager({
    homeDir: homedir(),
    commands: config.terminal.commands,
    audit: async (event) => {
      await audit.record({
        action: event.event,
        outcome: "ok",
        durationMs: 0,
        metadata: {
          profile: event.profile,
          rootCount: event.rootCount,
          scopeDigest: event.scopeDigest,
          ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
        },
      });
    },
  });
  return {
    config,
    policy,
    audit,
    authority,
    authorityRequests: options.authorityRequests ?? new AuthorityRequestManager(),
    approvalBroker: options.approvalBroker ?? new MacOSLocalAuthorityBroker({ helperPath: DEFAULT_APPROVAL_HELPER_PATH }),
    fs: new FileSystemService(policy, audit, config.limits),
    git: new GitService(policy, audit, config),
    process: new ProcessService(policy, audit, config),
  };
}

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

function withAuthority(runtime: RuntimeServices, authorityLeaseId: string) {
  const authority = runtime.authority.resolve(authorityLeaseId);
  return createScopedRuntime(runtime, authority);
}

function requestStateFromBrokerOutcome(outcome: LocalAuthorityOutcome) {
  if (outcome === "authenticated") return "approved" as const;
  if (outcome === "denied") return "denied" as const;
  if (outcome === "cancelled") return "cancelled" as const;
  return "failed" as const;
}

function settleApprovalRequest(
  runtime: RuntimeServices,
  requestId: string,
  state: "approved" | "denied" | "cancelled" | "failed",
): void {
  try {
    runtime.authorityRequests.complete(requestId, state);
  } catch {
    // Expired or already-settled requests remain fail-closed. Native completion never revives them.
  }
}

const authorityLeaseField = { authorityLeaseId: z.string().min(40) };
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const nonDestructiveWriteAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sessionStartAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const approvalStatusAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const guardedMutationAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export function createMcpServer(runtime: RuntimeServices): McpServer {
  const server = new McpServer(
    { name: "chatgpt-system", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "system_capabilities",
    {
      description: "Show bootstrap filesystem roots, safety limits, audit path, and startup terminal configuration. Session leases can grant broader scoped authority.",
      inputSchema: z.object({}),
      outputSchema: systemCapabilitiesOutputSchema,
      annotations: readAnnotations,
    },
    async () => safeCall(async () => ({
      roots: runtime.config.roots,
      auditFile: runtime.config.auditFile,
      terminal: runtime.config.terminal,
      limits: runtime.config.limits,
      safety: {
        filesystemConfinement: true as const,
        symlinkEscapeProtection: true as const,
        writeConflictProtection: "optimistic-sha256" as const,
        atomicFileReplacement: true as const,
        linearizableExternalWriterCAS: false as const,
        hostileLocalFilesystemRaceProtection: false as const,
        terminalOsSandboxed: false as const,
      },
    })),
  );

  server.registerTool(
    "session_authority_start",
    {
      description: "Start a direct Project authority lease. User and Admin authority require a separate native Mac approval request first.",
      inputSchema: z.object({
        profile: z.enum(["project", "user", "admin"]),
        projectRoots: z.array(z.string()).optional(),
        requestedTtlSeconds: z.number().int().positive().optional(),
      }),
      outputSchema: authorityLeaseOutputSchema,
      annotations: sessionStartAnnotations,
    },
    async ({ profile, projectRoots, requestedTtlSeconds }) => safeCall(async () => {
      if (profile !== "project") {
        throw new LocalApprovalRequiredError(
          "User and Admin authority must be approved locally on the Mac. Use session_authority_request.",
          { profile },
        );
      }
      const lease = await runtime.authority.start({
        profile,
        ...(projectRoots ? { projectRoots } : {}),
        ...(requestedTtlSeconds !== undefined ? { requestedTtlSeconds } : {}),
      });
      await runtime.authority.flushAudit();
      return lease;
    }),
  );

  server.registerTool(
    "session_authority_request",
    {
      description: "Request local Mac approval for User or Admin authority. This only creates a short-lived pending request; the Mac owner must authenticate locally before any lease can be issued.",
      inputSchema: z.object({
        profile: z.enum(["user", "admin"]),
        requestedTtlSeconds: z.number().int().positive().optional(),
      }),
      outputSchema: authorityRequestOutputSchema,
      annotations: sessionStartAnnotations,
    },
    async ({ profile, requestedTtlSeconds }) => safeCall(async () => {
      const request = runtime.authorityRequests.create({
        profile,
        ...(requestedTtlSeconds !== undefined ? { requestedTtlSeconds } : {}),
      });

      void runtime.approvalBroker.request({ requestId: request.requestId, profile: request.profile })
        .then((result) => {
          settleApprovalRequest(runtime, request.requestId, requestStateFromBrokerOutcome(result.outcome));
        })
        .catch(() => {
          settleApprovalRequest(runtime, request.requestId, "failed");
        });

      return request;
    }),
  );

  server.registerTool(
    "session_authority_request_status",
    {
      description: "Check a local approval request. If native approval has completed, the first successful status call atomically consumes it and returns one User/Admin authority lease.",
      inputSchema: z.object({ requestId: z.string().min(40) }),
      outputSchema: authorityRequestStatusOutputSchema,
      annotations: approvalStatusAnnotations,
    },
    async ({ requestId }) => safeCall(async () => {
      const current = runtime.authorityRequests.resolve(requestId);
      if (current.state !== "approved") return current;

      const consumed = runtime.authorityRequests.consumeApproved(requestId);
      const lease = await runtime.authority.start({
        profile: consumed.profile,
        ...(consumed.requestedTtlSeconds !== undefined
          ? { requestedTtlSeconds: consumed.requestedTtlSeconds }
          : {}),
      });
      await runtime.authority.flushAudit();
      return { ...consumed, lease };
    }),
  );

  server.registerTool(
    "session_authority_status",
    {
      description: "Inspect an active authority lease without changing it.",
      inputSchema: z.object(authorityLeaseField),
      outputSchema: authorityLeaseOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(async () => runtime.authority.status(authorityLeaseId)),
  );

  server.registerTool(
    "session_authority_end",
    {
      description: "Revoke an active authority lease immediately. The same leaseId cannot be used again.",
      inputSchema: z.object(authorityLeaseField),
      outputSchema: authorityEndOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(async () => {
      const result = runtime.authority.end(authorityLeaseId);
      await runtime.authority.flushAudit();
      return result;
    }),
  );

  server.registerTool(
    "fs_list",
    {
      description: "List one directory inside the active authority lease scope without following directory entries.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string().default(".") }),
      outputSchema: fsListOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, path }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.list(path)),
  );

  server.registerTool(
    "fs_stat",
    {
      description: "Inspect a path inside the active authority lease scope. Small regular files include a SHA-256 hash for conflict-safe writes.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string() }),
      outputSchema: fsStatOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, path }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.stat(path)),
  );

  server.registerTool(
    "fs_read",
    {
      description: "Read a regular file inside the active authority lease scope and return its content plus SHA-256. Use that hash for later modifications.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string(), encoding: z.enum(["utf8", "base64"]).default("utf8") }),
      outputSchema: fsReadOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, path, encoding }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.read(path, encoding)),
  );

  server.registerTool(
    "fs_write",
    {
      description: "Create or atomically replace a file inside the active authority lease scope. Replacing an existing file requires expectedSha256 from a prior read/stat.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }),
      outputSchema: fsWriteOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ authorityLeaseId, path, content, encoding, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.write(path, content, encoding, expectedSha256)),
  );

  server.registerTool(
    "fs_apply_patch",
    {
      description: "Apply a unified diff inside the active authority lease scope only if the file's current SHA-256 matches expectedSha256.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        patch: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      outputSchema: fsPatchOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ authorityLeaseId, path, patch, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.patch(path, patch, expectedSha256)),
  );

  server.registerTool(
    "fs_mkdir",
    {
      description: "Create a directory and missing parents inside the active authority lease scope.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string() }),
      outputSchema: fsMkdirOutputSchema,
      annotations: nonDestructiveWriteAnnotations,
    },
    async ({ authorityLeaseId, path }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.makeDirectory(path)),
  );

  server.registerTool(
    "fs_move",
    {
      description: "Move a file or directory inside the active authority lease scope. Existing file sources require expectedSha256.",
      inputSchema: z.object({
        ...authorityLeaseField,
        source: z.string(),
        destination: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }),
      outputSchema: fsMoveOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ authorityLeaseId, source, destination, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.move(source, destination, expectedSha256)),
  );

  server.registerTool(
    "fs_remove",
    {
      description: "Remove a file or directory inside the active authority lease scope. Files require expectedSha256; directories require recursive=true. Allowed roots can never be removed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        recursive: z.boolean().default(false),
      }),
      outputSchema: fsRemoveOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ authorityLeaseId, path, expectedSha256, recursive }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.remove(path, expectedSha256, recursive)),
  );

  server.registerTool(
    "git_status",
    {
      description: "Read git status inside the active authority lease scope without running repository hooks or filesystem monitors.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default(".") }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, cwd }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.status(cwd)),
  );

  server.registerTool(
    "git_diff",
    {
      description: "Read a git diff inside the active authority lease scope with external diff/textconv disabled.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), staged: z.boolean().default(false) }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, cwd, staged }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.diff(cwd, staged)),
  );

  server.registerTool(
    "git_log",
    {
      description: "Read recent git commits inside the active authority lease scope without invoking repository hooks or credential prompts.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), limit: z.number().int().min(1).max(100).default(20) }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, cwd, limit }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.log(cwd, limit)),
  );

  server.registerTool(
    "terminal_run",
    {
      description: "Run an allowlisted executable with shell=false inside the active authority lease scope. Session authority enables this tool; it is NOT an OS sandbox.",
      inputSchema: z.object({
        ...authorityLeaseField,
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
      }),
      outputSchema: terminalResultOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ authorityLeaseId, command, args, cwd }) => safeCall(() => withAuthority(runtime, authorityLeaseId).process.run(command, args, cwd)),
  );

  return server;
}
