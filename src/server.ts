import { McpServer } from "@modelcontextprotocol/server";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AuthorityManager } from "./authority.js";
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
import { registerPatchSetTool } from "./patch-set-tool-registration.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import { ProcessSupervisor } from "./process-supervisor.js";
import { OwnerShellSupervisor } from "./owner-shell-supervisor.js";
import { NodePtyBackend } from "./terminal-pty-backend.js";
import { TerminalSessionSupervisor } from "./terminal-session-supervisor.js";
import {
  DEFAULT_MAX_MIRROR_FILE_BYTES,
  DEFAULT_MAX_MIRROR_SESSIONS,
  TERMINAL_MIRROR_DIRECTORY_NAME,
  TerminalMirror,
} from "./terminal-mirror.js";
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
import { registerSkillsTools } from "./skills-tool-registration.js";
import { registerGoalTool } from "./goal-tool-registration.js";
import { registerWorkerTools } from "./worker-tool-registration.js";
import { assertWorkerAliasLive } from "./worker-store.js";
import { registerHandoffTool } from "./handoff-tool-registration.js";
import { trackToolSurface } from "./tool-surface-publication.js";
import { applyToolExposure } from "./tool-exposure.js";
import { SessionEventStore } from "./session-event-store.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import { createOpenRuntime, createScopedRuntime } from "./scoped-runtime.js";
import { describeSystemEnvironment } from "./system-environment.js";
import { PolicyError } from "./errors.js";
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
  gitInventoryOutputSchema,
  gitFileReviewOutputSchema,
  processListOutputSchema,
  processLogsOutputSchema,
  processSummaryOutputSchema,
  systemCapabilitiesOutputSchema,
  systemEnvironmentOutputSchema,
  terminalResultOutputSchema,
} from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";

export interface RuntimeServices extends ProjectContinuityRuntime {
  config: AppConfig;
  policy: PathPolicy;
  audit: AuditLogger;
  authority: AuthorityManager;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
  processSupervisor: ProcessSupervisor;
  ownerShellSupervisor: OwnerShellSupervisor;
  terminalSessionSupervisor: TerminalSessionSupervisor;
  terminalMirror: TerminalMirror;
  projectExecBackend: ProjectExecBackend;
  projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
  taskStateRoot: string;
  worktreeRoot: string;
  browser: BrowserService;
  sessionEventStore?: SessionEventStore;
  computer: ComputerRuntime;
  computerJs: ComputerJsRuntime;
}

export interface RuntimeOptions extends BrowserFactoryOptions {
  computerNative?: ComputerNativeRequesting;
  computerRuntime?: ComputerRuntime;
  computerJsRuntime?: ComputerJsRuntime;
  projectExecBackend?: ProjectExecBackend;
  projectCheckHostExecutorFactory?: ProjectCheckHostExecutorFactory;
  taskStateRoot?: string;
  sessionEventStore?: SessionEventStore;
  worktreeRoot?: string;
  processPersistencePath?: string;
}

export function createRuntimeServices(config: AppConfig, options: RuntimeOptions = {}): RuntimeServices {
  if (options.sessionEventStore && config.sessionEvents?.enabled !== true) {
    throw new PolicyError("An injected session metadata store requires explicit opt-in.");
  }
  const policy = new PathPolicy(config.roots);
  const audit = new AuditLogger(config.auditFile);
  const authority = new AuthorityManager({
    homeDir: homedir(),
    commands: config.terminal.commands,
    terminalEnabled: config.terminal.enabled,
    audit: async (event) => {
      if (event.event === "authority.denied") {
        // Recorded as an error so lease-resolution refusals show up in ordinary audit error-code analysis.
        await audit.record({
          action: event.event,
          outcome: "error",
          durationMs: 0,
          metadata: {
            reason: event.reason,
            deniedCount: event.deniedCount,
            windowStartedAt: event.windowStartedAt,
            errorCode: "AUTHORITY_REQUIRED",
          },
        });
        return;
      }
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
  const processSupervisor = new ProcessSupervisor({
    limits: config.limits,
    audit,
    persistencePath: options.processPersistencePath ?? path.join(homedir(), ".chatgpt-system", "processes"),
  });
  const ownerShellSupervisor = new OwnerShellSupervisor({
    maxRetainedBytesPerStream: config.limits.maxCommandOutputBytes,
    processStopGraceMs: config.limits.processStopGraceMs,
  });
  const taskStateRoot = path.resolve(options.taskStateRoot ?? path.join(homedir(), ".chatgpt-system", "state"));
  const terminalMirror = new TerminalMirror(path.join(taskStateRoot, TERMINAL_MIRROR_DIRECTORY_NAME), {
    maxFileBytes: DEFAULT_MAX_MIRROR_FILE_BYTES,
    maxSessions: DEFAULT_MAX_MIRROR_SESSIONS,
  });
  const terminalSessionSupervisor = new TerminalSessionSupervisor({
    backend: new NodePtyBackend(),
    maxSessions: config.ownerRuntime?.maxTerminalSessions ?? 32,
    maxOutputBytes: config.ownerRuntime?.maxTerminalOutputBytes ?? 262_144,
    maxInputBytes: config.ownerRuntime?.maxTerminalInputBytes ?? 65_536,
    processStopGraceMs: config.limits.processStopGraceMs,
    mirror: terminalMirror,
  });
  const projectExecBackend = options.projectExecBackend ?? new DockerProjectExecBackend({
    maxOutputBytes: config.limits.maxCommandOutputBytes,
    cleanupTimeoutMs: config.limits.processStopGraceMs,
  });
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
  const fs = new FileSystemService(policy, audit, config.limits);
  const git = new GitService(policy, audit, config);
  const process = new ProcessService(policy, audit, config);
  let sessionEventStore: SessionEventStore | undefined;
  try {
    if (config.sessionEvents?.enabled === true) {
      sessionEventStore = options.sessionEventStore
        ?? new SessionEventStore({ databasePath: path.join(taskStateRoot, "session-events", "metadata.db") });
    }
  } catch (error) {
    continuityRuntime.continuityStore.close();
    throw error;
  }
  return {
    ...continuityRuntime,
    config,
    policy,
    audit,
    authority,
    fs,
    git,
    process,
    processSupervisor,
    ownerShellSupervisor,
    terminalSessionSupervisor,
    terminalMirror,
    projectExecBackend,
    ...(options.projectCheckHostExecutorFactory !== undefined
      ? { projectCheckHostExecutorFactory: options.projectCheckHostExecutorFactory }
      : {}),
    taskStateRoot,
    worktreeRoot,
    browser,
    computer,
    computerJs,
    ...(sessionEventStore ? { sessionEventStore } : {}),
  };
}

function withScope(runtime: RuntimeServices, authorityLeaseId?: string) {
  if (authorityLeaseId !== undefined) {
    const authority = runtime.authority.resolve(authorityLeaseId);
    return createScopedRuntime(runtime, authority);
  }
  return createOpenRuntime(runtime);
}

function withAuthority(runtime: RuntimeServices, authorityLeaseId?: string) {
  return withScope(runtime, authorityLeaseId);
}

// Serbest mod: lease opsiyoneldir. Verilmezse bootstrap rootlarla açık kapsam kullanılır.
const authorityLeaseField = { authorityLeaseId: z.string().min(40).optional() };
const processIdField = { processId: z.string().min(40) };
const projectAuthorityStartInputSchema = z.object({
  profile: z.literal("project").optional(),
  projectRoots: z.array(z.string()).min(1),
  requestedTtlSeconds: z.coerce.number().int().positive().optional(),
});
type AuthorityStartInput = z.infer<typeof projectAuthorityStartInputSchema>;
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const nonDestructiveWriteAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sessionStartAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const guardedMutationAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const gitLocalMutationAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const gitRemoteMutationAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

// Oturum düzeyi iş akışı rehberi araç açıklamalarında değil burada durur;
// açıklamalar yalnızca aracın ne yaptığını anlatır.
export const SERVER_INSTRUCTIONS = "chatgpt-system gives access to the user's local project workspace. To continue a registered project, call project_resume with its exact alias (project_list when the alias is unknown) and reconcile Git state before any project mutation. If the host reports 'This conversation does not support developer MCPs', that is developer MCP product-surface/tool-routing unavailability, not a local daemon failure: do not repeatedly retry the unavailable namespace, do not substitute container access, and do not claim local changes; continue in a new or recovered chat and call project_resume before mutation.";

export function createMcpServer(runtime: RuntimeServices): McpServer {
  const authorityStartInputSchema = projectAuthorityStartInputSchema;
  const server = new McpServer(
    { name: "chatgpt-system", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  trackToolSurface(server);
  applyToolExposure(server, runtime.config);

  server.registerTool(
    "system_capabilities",
    {
      description: "Show bootstrap filesystem roots, safety limits, audit path, and startup terminal configuration. Bootstrap roots are defaults only: Project leases may target other explicit project directories outside bootstrap roots, while filesystem root and the entire home directory remain forbidden for Project authority.",
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
      ownerRuntime: {
        enabled: runtime.config.ownerRuntime?.enabled === true,
      },
      skills: {
        enabled: runtime.config.skills.enabled,
      },
      goal: {
        enabled: runtime.config.goal.enabled,
      },
      workers: {
        enabled: runtime.config.workers.enabled,
        maxWorkers: runtime.config.workers.maxWorkers,
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
      description: "Describe the local runtime environment without running terminal commands. Bootstrap roots are defaults only: Project leases may target other explicit project directories outside bootstrap roots. Read-only; exposes no secret values.",
      inputSchema: z.object({}),
      outputSchema: systemEnvironmentOutputSchema,
      annotations: readAnnotations,
    },
    async () => safeCall(async () => describeSystemEnvironment(runtime.config)),
  );

  server.registerTool(
    "session_authority_start",
    {
      description: "Start a Project lease for explicit project roots, including project directories outside bootstrap roots. The lease is optional scoping: every tool also works without authorityLeaseId against the bootstrap roots. For a new project: start the exact Project lease, project_register once for continuity, then use project_resume in later chats. Filesystem root and the entire home directory are refused for Project authority.",
      inputSchema: authorityStartInputSchema,
      outputSchema: authorityLeaseOutputSchema,
      annotations: sessionStartAnnotations,
    },
    async (input: AuthorityStartInput) => safeCall(async () => {
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
      inputSchema: z.object({ authorityLeaseId: z.string().min(40) }),
      outputSchema: authorityLeaseOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(async () => runtime.authority.status(authorityLeaseId)),
  );

  server.registerTool(
    "session_authority_end",
    {
      description: "Revoke an active authority lease immediately. The same leaseId cannot be used again.",
      inputSchema: z.object({ authorityLeaseId: z.string().min(40) }),
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
    "git_inventory",
    {
      description: "Return a complete, categorized Git worktree inventory with cursor pagination. Modified, untracked, deleted, and ignored paths remain distinct; this read does not stage or mutate anything.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), cursor: z.number().int().nonnegative().default(0), snapshot: z.string().regex(/^[a-f0-9]{64}$/).optional(), pageSize: z.number().int().min(1).max(200).default(100) }).strict(),
      outputSchema: gitInventoryOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, cwd, cursor, snapshot, pageSize }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.inventory(cwd, cursor, pageSize, snapshot)),
  );

  server.registerTool(
    "git_file_review",
    {
      description: "Review one explicit repository-relative file diff without staging or changing the worktree. Deleted files remain reviewable by path.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), path: z.string().min(1) }).strict(),
      outputSchema: gitFileReviewOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, cwd, path: filePath }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.fileReview(cwd, filePath)),
  );

  server.registerTool(
    "git_diff",
    {
      description: "Read a git diff or check it for whitespace errors inside the active authority lease scope with external diff/textconv disabled. Set check=true for git diff --check; combine with staged=true for git diff --cached --check. Nonzero exitCode means the check found errors; it does not bypass Git safety checks.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), staged: z.boolean().default(false), check: z.boolean().default(false) }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, cwd, staged, check }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.diff(cwd, staged, check)),
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
        expectedSha256: z.record(z.string(), z.union([z.string().regex(/^[a-f0-9]{64}$/), z.literal("deleted")])).optional(),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: nonDestructiveWriteAnnotations,
    },
    async ({ authorityLeaseId, cwd, paths, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.stagePaths(cwd, paths, expectedSha256)),
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
      description: "Push only a clean, fresh locally verified non-main branch from the exact active project_resume worktree to the existing credential-free GitHub origin. Requires the resumed Project authority lease; force, remote, refspec, branch, head, and verification overrides are not exposed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        projectAuthorityLeaseId: z.string().min(40),
        cwd: z.string().default("."),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: gitRemoteMutationAnnotations,
    },
    async ({ authorityLeaseId, projectAuthorityLeaseId, cwd }) => safeCall(async () => {
      const projectAuthority = runtime.authority.resolve(projectAuthorityLeaseId);
      const resumeContext = await runtime.continuity.revalidateResumeContext(projectAuthorityLeaseId);
      await assertWorkerAliasLive(
        {
          taskStateRoot: runtime.taskStateRoot,
          audit: runtime.audit,
          maxWorkers: runtime.config.workers.maxWorkers,
          maxParkedRuns: runtime.config.workers.maxParkedRuns,
        },
        resumeContext.alias,
      );
      const leaseScoped = authorityLeaseId !== undefined
        ? createScopedRuntime(runtime, runtime.authority.resolve(authorityLeaseId))
        : createOpenRuntime(runtime);
      const projectScoped = createScopedRuntime(runtime, projectAuthority);
      const projectCheck = createProjectCheckService(runtime, projectAuthorityLeaseId);
      const gate = new ProjectPublishGate({
        projectGit: projectScoped.git,
        adminGit: leaseScoped.git,
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
      description: "Run an allowlisted executable with shell=false inside the active scope. It is NOT an OS sandbox.",
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
      description: "Start an allowlisted long-running child process with shell=false inside the active scope. Returns an opaque managed-process ID, never an OS PID.",
      inputSchema: z.object({
        ...authorityLeaseField,
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
        idempotencyKey: z.string().min(1).max(256).optional(),
      }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ authorityLeaseId, command, args, cwd, idempotencyKey }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.start(command, args, cwd, idempotencyKey)),
  );

  server.registerTool(
    "process_list",
    {
      description: "List managed processes visible to the active scope. Hidden or out-of-scope records are omitted.",
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
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField, cursor: z.number().int().nonnegative().optional() }).strict(),
      outputSchema: processLogsOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, processId, cursor }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.logs(processId, cursor)),
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
  registerSkillsTools(server, runtime);
  registerGoalTool(server, runtime);
  registerWorkerTools(server, runtime);
  registerHandoffTool(server, runtime);
  return server;
}
