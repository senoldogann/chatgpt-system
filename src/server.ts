import { McpServer } from "@modelcontextprotocol/server";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AuthorityManager } from "./authority.js";
import { AuditLogger } from "./audit.js";
import { createBrowserService, type BrowserFactoryOptions } from "./browser-factory.js";
import { DockerProjectExecBackend } from "./docker-project-exec-backend.js";
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
import type { ProjectCheckHostExecutorFactory } from "./project-check-host-executor.js";
import { registerProjectCheckTool } from "./project-check-tool-registration.js";
import { registerProjectExecTool } from "./project-exec-tool-registration.js";
import { createProjectContinuityRuntime, type ProjectContinuityRuntime } from "./project-continuity-runtime.js";
import { registerProjectContinuityTools } from "./project-continuity-tool-registration.js";
import { registerTaskStateTool } from "./task-state-tool-registration.js";
import { registerSkillsTools } from "./skills-tool-registration.js";
import { registerGoalTool } from "./goal-tool-registration.js";
import { registerWorkerTools } from "./worker-tool-registration.js";
import { registerHandoffTool } from "./handoff-tool-registration.js";
import { trackToolSurface } from "./tool-surface-publication.js";
import { applyToolExposure } from "./tool-exposure.js";
import { SessionEventStore } from "./session-event-store.js";
import type { ProjectExecBackend } from "./project-exec-types.js";
import { PolicyError } from "./errors.js";
import { registerFileSystemTools } from "./fs-tool-registration.js";
import { registerGitTools } from "./git-tool-registration.js";
import { registerProcessTools } from "./process-tool-registration.js";
import { registerSystemTools } from "./system-tool-registration.js";

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


// Oturum düzeyi iş akışı rehberi araç açıklamalarında değil burada durur;
// açıklamalar yalnızca aracın ne yaptığını anlatır.
export const SERVER_INSTRUCTIONS = [
  "chatgpt-system gives access to the user's local project workspace. To continue a registered project, call project_resume with its exact alias (project_list when the alias is unknown) and reconcile Git state before any project mutation.",
  "Coding workflow, as in a desktop IDE agent: locate code with code_query (files for globs, search with regex/glob/contextLines, symbols, definition, references); read only the relevant lines with fs_read offset/limit; change existing files with fs_edit (exact unique oldString) or fs_apply_patch_set for coordinated multi-file edits, and fs_write for new files; check with code_query diagnostics and project_check; review with git_file_review or git_diff before git_commit. Keep each change minimal and verify it before reporting it as done.",
  "If the host reports 'This conversation does not support developer MCPs', that is developer MCP product-surface/tool-routing unavailability, not a local daemon failure: do not repeatedly retry the unavailable namespace, do not substitute container access, and do not claim local changes; continue in a new or recovered chat and call project_resume before mutation.",
].join("\n\n");

export function createMcpServer(runtime: RuntimeServices): McpServer {
  const server = new McpServer(
    { name: "chatgpt-system", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );
  trackToolSurface(server);
  applyToolExposure(server, runtime.config);

  registerSystemTools(server, runtime);
  registerFileSystemTools(server, runtime);
  registerGitTools(server, runtime);
  registerOwnerShellTool(server, runtime);
  registerTerminalSessionTools(server, runtime);
  registerProcessTools(server, runtime);


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
