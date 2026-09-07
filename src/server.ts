import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { AuditLogger } from "./audit.js";
import { FileSystemService } from "./fs-service.js";
import { GitService } from "./git-service.js";
import { PathPolicy } from "./policy.js";
import { ProcessService } from "./process-service.js";
import { errorPayload } from "./errors.js";
import {
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

export interface RuntimeServices {
  config: AppConfig;
  policy: PathPolicy;
  audit: AuditLogger;
  fs: FileSystemService;
  git: GitService;
  process: ProcessService;
}

export function createRuntimeServices(config: AppConfig): RuntimeServices {
  const policy = new PathPolicy(config.roots);
  const audit = new AuditLogger(config.auditFile);
  return {
    config,
    policy,
    audit,
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

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const nonDestructiveWriteAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
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
      description: "Show allowed filesystem roots, safety limits, audit path, and whether terminal execution is enabled.",
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
    "fs_list",
    {
      description: "List one directory inside an allowed root without following directory entries.",
      inputSchema: z.object({ path: z.string().default(".") }),
      outputSchema: fsListOutputSchema,
      annotations: readAnnotations,
    },
    async ({ path }) => safeCall(() => runtime.fs.list(path)),
  );

  server.registerTool(
    "fs_stat",
    {
      description: "Inspect a path. Small regular files include a SHA-256 hash for conflict-safe writes.",
      inputSchema: z.object({ path: z.string() }),
      outputSchema: fsStatOutputSchema,
      annotations: readAnnotations,
    },
    async ({ path }) => safeCall(() => runtime.fs.stat(path)),
  );

  server.registerTool(
    "fs_read",
    {
      description: "Read a regular file and return its content plus SHA-256. Use that hash for later modifications.",
      inputSchema: z.object({ path: z.string(), encoding: z.enum(["utf8", "base64"]).default("utf8") }),
      outputSchema: fsReadOutputSchema,
      annotations: readAnnotations,
    },
    async ({ path, encoding }) => safeCall(() => runtime.fs.read(path, encoding)),
  );

  server.registerTool(
    "fs_write",
    {
      description: "Create or atomically replace a file. Replacing an existing file requires expectedSha256 from a prior read/stat.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }),
      outputSchema: fsWriteOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ path, content, encoding, expectedSha256 }) => safeCall(() => runtime.fs.write(path, content, encoding, expectedSha256)),
  );

  server.registerTool(
    "fs_apply_patch",
    {
      description: "Apply a unified diff to a UTF-8 file only if its current SHA-256 matches expectedSha256.",
      inputSchema: z.object({
        path: z.string(),
        patch: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      outputSchema: fsPatchOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ path, patch, expectedSha256 }) => safeCall(() => runtime.fs.patch(path, patch, expectedSha256)),
  );

  server.registerTool(
    "fs_mkdir",
    {
      description: "Create a directory and missing parents inside an allowed root.",
      inputSchema: z.object({ path: z.string() }),
      outputSchema: fsMkdirOutputSchema,
      annotations: nonDestructiveWriteAnnotations,
    },
    async ({ path }) => safeCall(() => runtime.fs.makeDirectory(path)),
  );

  server.registerTool(
    "fs_move",
    {
      description: "Move a file or directory inside allowed roots. Existing file sources require expectedSha256.",
      inputSchema: z.object({
        source: z.string(),
        destination: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }),
      outputSchema: fsMoveOutputSchema,
      annotations: guardedMutationAnnotations,
    },
    async ({ source, destination, expectedSha256 }) => safeCall(() => runtime.fs.move(source, destination, expectedSha256)),
  );

  server.registerTool(
    "fs_remove",
    {
      description: "Remove a file or directory. Files require expectedSha256; directories require recursive=true. Allowed roots can never be removed.",
      inputSchema: z.object({
        path: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        recursive: z.boolean().default(false),
      }),
      outputSchema: fsRemoveOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ path, expectedSha256, recursive }) => safeCall(() => runtime.fs.remove(path, expectedSha256, recursive)),
  );

  server.registerTool(
    "git_status",
    {
      description: "Read git status without running repository hooks or filesystem monitors.",
      inputSchema: z.object({ cwd: z.string().default(".") }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ cwd }) => safeCall(() => runtime.git.status(cwd)),
  );

  server.registerTool(
    "git_diff",
    {
      description: "Read a git diff with external diff/textconv disabled.",
      inputSchema: z.object({ cwd: z.string().default("."), staged: z.boolean().default(false) }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ cwd, staged }) => safeCall(() => runtime.git.diff(cwd, staged)),
  );

  server.registerTool(
    "git_log",
    {
      description: "Read recent git commits without invoking repository hooks or credential prompts.",
      inputSchema: z.object({ cwd: z.string().default("."), limit: z.number().int().min(1).max(100).default(20) }),
      outputSchema: gitResultOutputSchema,
      annotations: readAnnotations,
    },
    async ({ cwd, limit }) => safeCall(() => runtime.git.log(cwd, limit)),
  );

  server.registerTool(
    "terminal_run",
    {
      description: "Run an allowlisted executable with shell=false in an allowed cwd. Disabled by default and NOT an OS sandbox.",
      inputSchema: z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
      }),
      outputSchema: terminalResultOutputSchema,
      annotations: destructiveAnnotations,
    },
    async ({ command, args, cwd }) => safeCall(() => runtime.process.run(command, args, cwd)),
  );

  return server;
}
