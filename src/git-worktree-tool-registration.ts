import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { AuthorityDeniedError, errorPayload } from "./errors.js";
import { ManagedWorktreeService } from "./managed-worktree-service.js";
import { PathPolicy } from "./policy.js";
import { gitWorktreeOutputSchema } from "./tool-output-schemas.js";

export interface GitWorktreeToolRuntime {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  taskStateRoot: string;
  worktreeRoot: string;
}

const annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const inputSchema = z.discriminatedUnion("operation", [
  z.object({
    authorityLeaseId: z.string().min(40),
    operation: z.literal("create"),
    cwd: z.string().default("."),
    branch: z.string().min(1).max(200),
  }).strict(),
  z.object({
    authorityLeaseId: z.string().min(40),
    operation: z.literal("status"),
    worktreeId: z.string().uuid(),
  }).strict(),
  z.object({
    authorityLeaseId: z.string().min(40),
    operation: z.literal("remove"),
    worktreeId: z.string().uuid(),
  }).strict(),
]);

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

export function registerGitWorktreeTool(server: McpServer, runtime: GitWorktreeToolRuntime): void {
  server.registerTool(
    "git_worktree",
    {
      description: "Create, inspect, or remove plugin-owned Git worktrees. Callers never provide managed filesystem paths; dirty or unmanaged worktrees are never removed.",
      inputSchema,
      outputSchema: gitWorktreeOutputSchema,
      annotations,
    },
    async (input) => safeCall(async () => {
      const authority = runtime.authority.resolve(input.authorityLeaseId);
      if (authority.profile !== "project") {
        throw new AuthorityDeniedError("Managed Git worktrees require a Project authority lease.");
      }
      const service = new ManagedWorktreeService(
        new PathPolicy([...authority.roots]),
        runtime.audit,
        runtime.config.limits,
        runtime.taskStateRoot,
        runtime.worktreeRoot,
      );
      if (input.operation === "create") return service.create(input.cwd, input.branch);
      if (input.operation === "status") return service.status(input.worktreeId);
      return service.remove(input.worktreeId);
    }),
  );
}
