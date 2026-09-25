import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { ManagedWorktreeService } from "./managed-worktree-service.js";
import { PathPolicy } from "./policy.js";
import { gitWorktreeOutputSchema } from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";
import { DESTRUCTIVE } from "./tool-annotations.js";

export interface GitWorktreeToolRuntime {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  taskStateRoot: string;
  worktreeRoot: string;
}

const inputSchema = z.discriminatedUnion("operation", [
  z.object({
    authorityLeaseId: z.string().min(40).optional(),
    operation: z.literal("create"),
    cwd: z.string().default("."),
    branch: z.string().min(1).max(200),
  }).strict(),
  z.object({
    authorityLeaseId: z.string().min(40).optional(),
    operation: z.literal("status"),
    worktreeId: z.string().uuid(),
  }).strict(),
  z.object({
    authorityLeaseId: z.string().min(40).optional(),
    operation: z.literal("remove"),
    worktreeId: z.string().uuid(),
  }).strict(),
]);

export function registerGitWorktreeTool(server: McpServer, runtime: GitWorktreeToolRuntime): void {
  server.registerTool(
    "git_worktree",
    {
      description: "Create, inspect, or remove plugin-owned Git worktrees. Callers never provide managed filesystem paths; dirty or unmanaged worktrees are never removed.",
      inputSchema,
      outputSchema: gitWorktreeOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async (input) => safeCall(async () => {
      const roots = input.authorityLeaseId === undefined
        ? [...runtime.config.roots]
        : [...runtime.authority.resolve(input.authorityLeaseId).roots];
      const service = new ManagedWorktreeService(
        new PathPolicy(roots),
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
