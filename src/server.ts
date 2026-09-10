import { McpServer } from "@modelcontextprotocol/server";
import { homedir } from "node:os";
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
import {
  MacOSLocalAuthorityBroker,
  type LocalAuthorityBroker,
} from "./local-authority-broker.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import { ProcessSupervisor } from "./process-supervisor.js";
import { registerProjectExecTool } from "./project-exec-tool-registration.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import { createScopedRuntime } from "./scoped-runtime.js";
import { describeSystemEnvironment } from "./system-environment.js";
import { errorPayload, PolicyError } from "./errors.js";
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
  processSupervisor: ProcessSupervisor;
  projectExecBackend: ProjectExecBackend;
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
  const projectExecBackend = options.projectExecBackend ?? new DockerProjectExecBackend({
    maxOutputBytes: config.limits.maxCommandOutputBytes,
    cleanupTimeoutMs: config.limits.processStopGraceMs,
  });
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
  return {
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
    projectExecBackend,
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
  requestedTtlSeconds: z.number().int().positive().optional(),
}).strict();
const adminAuthorityStartInputSchema = z.object({
  profile: z.literal("admin"),
  requestedTtlSeconds: z.number().int().positive().optional(),
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
    ? z.discriminatedUnion("profile", [projectAuthorityStartInputSchema, adminAuthorityStartInputSchema])
    : projectAuthorityStartInputSchema;
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
      personalAdmin: {
        enabled: personalAdminEnabled,
        adminLeaseMaxTtlSeconds: 3600 as const,
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
      description: "Describe the local runtime environment without running terminal commands: operating system, architecture, effective executable search path, roots, and allowlisted executable resolution (allowed vs available). Read-only; exposes no secret values.",
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
        ? "Start a Project lease or, in explicit Personal Admin mode, a short-lived Admin lease for normal daily-driver work. User authority remains locally approved."
        : "Start a direct Project authority lease for explicit project roots. User/Admin leases are created locally on the Mac with chatgpt-system authorize and then supplied to existing lease-aware tools.",
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
      description: "Push only the current validated branch to the existing credential-free GitHub origin. Requires an Admin authority lease; force, remote, refspec, and arbitrary Git arguments are not exposed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: gitRemoteMutationAnnotations,
    },
    async ({ authorityLeaseId, cwd }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.push(cwd)),
  );

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
  registerProjectExecTool(server, runtime);
  registerBrowserTools(server, runtime);
  registerComputerTools(server, runtime);
  registerComputerJsTools(server, runtime);
  return server;
}
