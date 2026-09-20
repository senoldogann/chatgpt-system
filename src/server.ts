import { McpServer } from "@modelcontextprotocol/server";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AuthorityManager } from "./authority.js";
import { AuthorityRequestManager } from "./authority-request-manager.js";
import { AuditLogger } from "./audit.js";
import { createBrowserService, type BrowserFactoryOptions } from "./browser-factory.js";
import { DockerProjectExecBackend, PROJECT_EXEC_IMAGE } from "./docker-project-exec-backend.js";
import type { BrowserService } from "./browser-service.js";
import { ComputerJsRuntime } from "./computer-js-runtime.js";
import { ComputerJsRunnerSupervisor } from "./computer-js-runner-supervisor.js";
import { ComputerNativeSupervisor } from "./computer-native-supervisor.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "./computer-runtime.js";
import { registerBrowserTools } from "./browser-tool-registration.js";
import { registerCodeQueryTool } from "./code-query-tool-registration.js";
import { registerComputerTools } from "./computer-tool-registration.js";
import { registerComputerJsTools } from "./computer-js-tool-registration.js";
import type { AppConfig } from "./config.js";
import { FileSystemService } from "./fs-service.js";
import { GitService } from "./git-service.js";
import { registerGitWorktreeTool } from "./git-worktree-tool-registration.js";
import {
  MacOSLocalAuthorityBroker,
  type LocalAuthorityBroker,
} from "./local-authority-broker.js";
import { registerPatchSetTool } from "./patch-set-tool-registration.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import { ProcessSupervisor } from "./process-supervisor.js";
import { OwnerShellSupervisor } from "./owner-shell-supervisor.js";
import { NodePtyBackend } from "./terminal-pty-backend.js";
import { TerminalSessionSupervisor } from "./terminal-session-supervisor.js";
import { registerTerminalSessionTools } from "./terminal-session-tool-registration.js";
import { registerOwnerShellTool } from "./owner-shell-tool-registration.js";
import { createProjectCheckService } from "./project-check-factory.js";
import type { ProjectCheckHostExecutorFactory } from "./project-check-host-executor.js";
import { registerProjectCheckTool } from "./project-check-tool-registration.js";
import { registerProjectExecTool } from "./project-exec-tool-registration.js";
import { ProjectPublishGate } from "./project-publish-gate.js";
import { createProjectContinuityRuntime, type ProjectContinuityRuntime } from "./project-continuity-runtime.js";
import { registerProjectContinuityTools } from "./project-continuity-tool-registration.js";
import { registerTaskStateTool } from "./task-state-tool-registration.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import { createScopedRuntime } from "./scoped-runtime.js";
import { describeSystemEnvironment } from "./system-environment.js";
import { AuthorityDeniedError, errorPayload, PolicyError } from "./errors.js";
import {
  authorityEndOutputSchema,
  authorityLeaseOutputSchema,
  fsListOutputSchema,
  fsMkdirOutputSchema,
  fsMoveOutputSchema,
  fsPatchOutputSchema,
  fsReadOutputSchema,
  fsRemoveOutputSchema,
  fsStatOutputSchema,
  fsWriteOutputSchema,
  gitResultOutputSchema,
  processListOutputSchema,
  processLogsOutputSchema,
  processSummaryOutputSchema,
  systemCapabilitiesOutputSchema,
  systemEnvironmentOutputSchema,
  terminalResultOutputSchema,
} from "./tool-output-schemas.js";

export interface RuntimeServices extends ProjectContinuityRuntime {
  config: AppConfig;
  policy: PathPolicy;
  audit: AuditLogger;
  authority: AuthorityManager;
  authorityRequests: AuthorityRequestManager;
  approvalBroker: LocalAuthorityBroker;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
  processSupervisor: ProcessSupervisor;
  ownerShellSupervisor: OwnerShellSupervisor;
  terminalSessionSupervisor: TerminalSessionSupervisor;
  projectExecBackend: ProjectExecBackend;
  projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
  taskStateRoot: string;
  worktreeRoot: string;
  browser: BrowserService;
  computer: ComputerRuntime;
  computerJs: ComputerJsRuntime;
}

export interface RuntimeOptions extends BrowserFactoryOptions {
  approvalBroker?: LocalAuthorityBroker;
  authorityRequests?: AuthorityRequestManager;
  computerNative?: ComputerNativeRequesting;
  computerRuntime?: ComputerRuntime;
  computerJsRuntime?: ComputerJsRuntime;
  projectExecBackend?: ProjectExecBackend;
  projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
  taskStateRoot?: string;
  worktreeRoot?: string;
}

export function createRuntimeServices(config: AppConfig, options: RuntimeOptions = {}): RuntimeServices {
  const policy = new PathPolicy(config.roots);
  const audit = new AuditLogger(config.auditFile);
  const authority = new AuthorityManager({
    homeDir: homedir(),
    commands: config.terminal.commands,
    terminalEnabled: config.terminal.enabled,
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
  const authorityRequests = options.authorityRequests ?? new AuthorityRequestManager({
    audit: async (event) => {
      await audit.record({
        action: event.event,
        outcome: "ok",
        durationMs: 0,
        metadata: {
          profile: event.profile,
          state: event.state,
          ...(event.requestedTtlSeconds !== undefined
            ? { requestedTtlSeconds: event.requestedTtlSeconds }
            : {}),
          ...(event.expiresAt ? { expiresAt: event.expiresAt } : {}),
        },
      });
    },
  });
  const processSupervisor = new ProcessSupervisor({ limits: config.limits, audit });
  const ownerShellSupervisor = new OwnerShellSupervisor({
    maxRetainedBytesPerStream: config.limits.maxCommandOutputBytes,
    processStopGraceMs: config.limits.processStopGraceMs,
  });
  const terminalSessionSupervisor = new TerminalSessionSupervisor({
    backend: new NodePtyBackend(),
    maxSessions: config.ownerRuntime?.maxTerminalSessions ?? 32,
    maxOutputBytes: config.ownerRuntime?.maxTerminalOutputBytes ?? 262_144,
    maxInputBytes: config.ownerRuntime?.maxTerminalInputBytes ?? 65_536,
    processStopGraceMs: config.limits.processStopGraceMs,
  });
  const projectExecBackend = options.projectExecBackend ?? new DockerProjectExecBackend({
    maxOutputBytes: config.limits.maxCommandOutputBytes,
    cleanupTimeoutMs: config.limits.processStopGraceMs,
  });
  const taskStateRoot = path.resolve(options.taskStateRoot ?? path.join(homedir(), ".chatgpt-system", "state"));
  const worktreeRoot = path.resolve(options.worktreeRoot ?? path.join(homedir(), ".chatgpt-system", "worktrees"));
  const browser = createBrowserService(config, options);
  const computer = options.computerRuntime ?? new ComputerRuntime(
    options.computerNative ?? new ComputerNativeSupervisor({
      enabled: config.computerUse.enabled,
      hostBundlePath: config.computerUse.hostBundlePath,
      requestTimeoutMs: config.computerUse.requestTimeoutMs,
    }),
    config.computerUse,
  );
  const computerJs = options.computerJsRuntime ?? new ComputerJsRuntime(
    computer,
    config,
    new ComputerJsRunnerSupervisor({
      runnerEntrypoint: fileURLToPath(new URL("./computer-js-runner.js", import.meta.url)),
      maxSourceBytes: config.computerUse.maxJsSourceBytes,
      maxOutputBytes: config.computerUse.maxJsOutputBytes,
      processStopGraceMs: config.limits.processStopGraceMs,
    }),
  );
  const continuityRuntime = createProjectContinuityRuntime(config, authority, { homeDir: homedir() });
  return {
    ...continuityRuntime,
    config,
    policy,
    audit,
    authority,
    authorityRequests,
    approvalBroker: options.approvalBroker ?? new MacOSLocalAuthorityBroker(),
    fs: new FileSystemService(policy, audit, config.limits),
    git: new GitService(policy, audit, config),
    process: new ProcessService(policy, audit, config),
    processSupervisor,
    ownerShellSupervisor,
    terminalSessionSupervisor,
    projectExecBackend,
    ...(options.projectCheckHostExecutorFactory !== undefined
      ? { projectCheckHostExecutorFactory: options.projectCheckHostExecutorFactory }
      : {}),
    taskStateRoot,
    worktreeRoot,
    browser,
    computer,
    computerJs,
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

const authorityLeaseField = { authorityLeaseId: z.string().min(40) };
const processIdField = { processId: z.string().min(40) };
const projectAuthorityStartInputSchema = z.object({
  profile: z.literal("project"),
  projectRoots: z.array(z.string()).min(1),
  requestedTtlSeconds: z.coerce.number().int().positive().optional(),
});
const adminAuthorityStartInputSchema = z.object({
  profile: z.literal("admin"),
  requestedTtlSeconds: z.coerce.number().int().positive().optional(),
}).strict();
type AuthorityStartInput =
  | z.infer<typeof projectAuthorityStartInputSchema>
  | z.infer<typeof adminAuthorityStartInputSchema>;
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const nonDestructiveWriteAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sessionStartAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const guardedMutationAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const gitLocalMutationAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const gitRemoteMutationAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function createMcpServer(runtime: RuntimeServices): McpServer {
  const personalAdminEnabled = runtime.config.personalAdmin?.enabled === true;
  const authorityStartInputSchema = personalAdminEnabled
    ? z.preprocess((val: any) => {
        if (val !== null && typeof val === "object" && !Array.isArray(val)
            && !Object.prototype.hasOwnProperty.call(val, "profile")) {
          return { ...val, profile: "admin" };
        }
        return val === undefined ? { profile: "admin" } : val;
      }, z.discriminatedUnion("profile", [projectAuthorityStartInputSchema, adminAuthorityStartInputSchema]))
    : projectAuthorityStartInputSchema;
  const server = new McpServer(
    { name: "chatgpt-system", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "system_capabilities",
    {
      description: "Show bootstrap filesystem roots, safety limits, audit path, and startup terminal configuration. Bootstrap roots are defaults only: Project leases may target other explicit project directories outside bootstrap roots, while filesystem root and the entire home directory remain forbidden for Project authority. If ChatGPT reports 'This conversation does not support developer MCPs', treat that as developer MCP product-surface/tool-routing unavailability; do not treat it as daemon failure. Do not repeatedly retry an unavailable developer-MCP namespace, do not substitute container/local-host access, and do not claim local changes. Move to a new supported or recovered chat when needed; once developer MCP capability returns, project_resume the exact registered project before mutation.",
      inputSchema: z.object({}),
      outputSchema: systemCapabilitiesOutputSchema,
      annotations: readAnnotations,
    },
    async () => safeCall(async () => ({
      roots: runtime.config.roots,
      projectAuthority: {
        bootstrapRootsAreDefaultsOnly: true as const,
        dynamicProjectRootsSupported: true as const,
        forbiddenBroadRoots: ["filesystem-root", "home-directory"] as const,
        recommendedOpenFlow: ["session_authority_start", "project_register", "project_resume"] as const,
      },
      auditFile: runtime.config.auditFile,
      terminal: runtime.config.terminal,
      personalAdmin: {
        enabled: personalAdminEnabled,
        adminLeaseMaxTtlSeconds: 3600 as const,
      },
      ownerRuntime: {
        enabled: runtime.config.ownerRuntime?.enabled === true,
      },
      computerUse: {
        enabled: runtime.config.computerUse?.enabled === true,
        fullHostJsEnabled: runtime.config.computerUse?.fullHostJsEnabled === true,
      },
      projectExecution: {
        enabled: runtime.config.projectExec.enabled,
        sandboxed: true as const,
        backend: "docker" as const,
        network: "none" as const,
        hostFallback: false as const,
        image: PROJECT_EXEC_IMAGE,
      },
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
    "system_environment",
    {
      description: "Describe the local runtime environment without running terminal commands. Bootstrap roots are defaults only: Project leases may target other explicit project directories outside bootstrap roots. If ChatGPT reports 'This conversation does not support developer MCPs', treat that as developer MCP product-surface/tool-routing unavailability; do not treat it as daemon failure. Do not repeatedly retry an unavailable developer-MCP namespace, do not substitute container/local-host access, and do not claim local changes. Move to a new supported or recovered chat when needed; once developer MCP capability returns, project_resume the exact registered project before mutation. Read-only; exposes no secret values.",
      inputSchema: z.object({}),
      outputSchema: systemEnvironmentOutputSchema,
      annotations: readAnnotations,
    },
    async () => safeCall(async () => describeSystemEnvironment(runtime.config)),
  );

  server.registerTool(
    "session_authority_start",
    {
      description: personalAdminEnabled
        ? "Start a Project lease for explicit project roots, including project directories outside bootstrap roots, or in Personal Admin mode a short-lived Admin lease. For a new project: start the exact Project lease, project_register once for continuity, then use project_resume in later chats. Filesystem root and the entire home directory are refused for Project authority."
        : "Start a direct Project authority lease for explicit project roots, including project directories outside bootstrap roots. For a new project: start the exact Project lease, project_register once for continuity, then use project_resume in later chats. Filesystem root and the entire home directory are refused; User/Admin leases remain locally approved.",
      inputSchema: authorityStartInputSchema,
      outputSchema: authorityLeaseOutputSchema,
      annotations: sessionStartAnnotations,
    },
    async (input: AuthorityStartInput) => safeCall(async () => {
      if (input.profile === "admin") {
        if (!personalAdminEnabled) throw new PolicyError("Personal Admin authority is disabled.");
        const lease = await runtime.authority.start({
          profile: "admin",
          ...(input.requestedTtlSeconds !== undefined
            ? { requestedTtlSeconds: input.requestedTtlSeconds }
            : {}),
        });
        await runtime.authority.flushAudit();
        return lease;
      }

      const lease = await runtime.authority.start({
        profile: "project",
        projectRoots: input.projectRoots,
        ...(input.requestedTtlSeconds !== undefined
          ? { requestedTtlSeconds: input.requestedTtlSeconds }
          : {}),
      });
      await runtime.authority.flushAudit();
      return lease;
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
    "git_create_branch",
    {
      description: "Create and switch to one validated local Git branch inside the active authority scope. Arbitrary Git arguments, hooks, and remote changes are not exposed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        branch: z.string().min(1).max(200),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: gitLocalMutationAnnotations,
    },
    async ({ authorityLeaseId, cwd, branch }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.createBranch(cwd, branch)),
  );

  server.registerTool(
    "git_switch_branch",
    {
      description: "Switch to one validated existing local Git branch inside the active authority scope. No arbitrary checkout arguments are accepted.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        branch: z.string().min(1).max(200),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: nonDestructiveWriteAnnotations,
    },
    async ({ authorityLeaseId, cwd, branch }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.switchBranch(cwd, branch)),
  );

  server.registerTool(
    "git_stage_paths",
    {
      description: "Stage 1-100 explicit file paths inside the selected repository directory after authority-scope validation. Directory-wide and out-of-scope path staging are rejected.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        paths: z.array(z.string().min(1)).min(1).max(100),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: nonDestructiveWriteAnnotations,
    },
    async ({ authorityLeaseId, cwd, paths }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.stagePaths(cwd, paths)),
  );

  server.registerTool(
    "git_commit",
    {
      description: "Create one local Git commit from the existing index with a bounded commit message. Repository hooks and GPG signing are disabled for this operation.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        message: z.string().min(1).max(500),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: gitLocalMutationAnnotations,
    },
    async ({ authorityLeaseId, cwd, message }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.commit(cwd, message)),
  );

  server.registerTool(
    "git_merge_branch",
    {
      description: "Merge one validated local branch into the current branch with --no-ff and --no-edit. No arbitrary merge options are accepted.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        branch: z.string().min(1).max(200),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: gitLocalMutationAnnotations,
    },
    async ({ authorityLeaseId, cwd, branch }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.mergeBranch(cwd, branch)),
  );

  server.registerTool(
    "git_push",
    {
      description: "Push only a clean, fresh locally verified non-main branch from the exact active project_resume worktree to the existing credential-free GitHub origin. Requires active Admin and resumed Project authority leases; force, remote, refspec, branch, head, and verification overrides are not exposed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        projectAuthorityLeaseId: z.string().min(40),
        cwd: z.string().default("."),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: gitRemoteMutationAnnotations,
    },
    async ({ authorityLeaseId, projectAuthorityLeaseId, cwd }) => safeCall(async () => {
      const adminAuthority = runtime.authority.resolve(authorityLeaseId);
      if (adminAuthority.profile !== "admin") {
        throw new AuthorityDeniedError("Git push requires an active Admin authority lease.");
      }
      const projectAuthority = runtime.authority.resolve(projectAuthorityLeaseId);
      if (projectAuthority.profile !== "project") {
        throw new AuthorityDeniedError("Git push requires an active Project authority lease created by project_resume.");
      }
      const resumeContext = await runtime.continuity.revalidateResumeContext(projectAuthorityLeaseId);
      const adminScoped = createScopedRuntime(runtime, adminAuthority);
      const projectScoped = createScopedRuntime(runtime, projectAuthority);
      const projectCheck = createProjectCheckService(runtime, projectAuthorityLeaseId);
      const gate = new ProjectPublishGate({
        projectGit: projectScoped.git,
        adminGit: adminScoped.git,
        projectCheck,
      });
      return gate.push({ cwd, resumeContext });
    }),
  );

  registerOwnerShellTool(server, runtime);
  registerTerminalSessionTools(server, runtime);

  server.registerTool(
    "terminal_run",
    {
      description: "Run an allowlisted executable with shell=false inside an active Admin authority lease scope. Project/User leases do not have terminal capability; it is NOT an OS sandbox.",
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

  server.registerTool(
    "process_start",
    {
      description: "Start an allowlisted long-running child process with shell=false inside an active Admin authority scope. Returns an opaque managed-process ID, never an OS PID.",
      inputSchema: z.object({
        ...authorityLeaseField,
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
      }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: sessionStartAnnotations,
    },
    async ({ authorityLeaseId, command, args, cwd }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.start(command, args, cwd)),
  );

  server.registerTool(
    "process_list",
    {
      description: "List managed processes visible to the active terminal-capable authority scope. Hidden or out-of-scope records are omitted.",
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: processListOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.list()),
  );

  server.registerTool(
    "process_status",
    {
      description: "Read one manageable process state by opaque managed-process ID. Unknown and unauthorized IDs return the same error.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, processId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.status(processId)),
  );

  server.registerTool(
    "process_logs",
    {
      description: "Read bounded in-memory stdout/stderr tails for one manageable process. No log files or OS PID access are exposed.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField }).strict(),
      outputSchema: processLogsOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, processId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.logs(processId)),
  );

  server.registerTool(
    "process_stop",
    {
      description: "Idempotently stop one manageable process. The daemon chooses SIGTERM/grace/SIGKILL internally; callers cannot provide PIDs or signals.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ authorityLeaseId, processId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.stop(processId)),
  );

  registerCodeQueryTool(server, runtime);
  registerGitWorktreeTool(server, runtime);
  registerPatchSetTool(server, runtime);
  registerProjectCheckTool(server, runtime);
  registerTaskStateTool(server, runtime);
  registerProjectExecTool(server, runtime);
  registerProjectContinuityTools(server, runtime);
  registerBrowserTools(server, runtime);
  registerComputerTools(server, runtime);
  registerComputerJsTools(server, runtime);
  return server;
}
