import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "../core/authority.js";
import { createOpenRuntime, createScopedRuntime, type ScopedRuntimeBase } from "../core/scoped-runtime.js";
import { projectExecResultOutputSchema } from "../mcp/tool-output-schemas.js";
import { safeCall } from "../mcp/tool-result.js";
import { DESTRUCTIVE } from "../mcp/tool-annotations.js";

export interface ProjectExecToolRuntime extends ScopedRuntimeBase {
  authority: AuthorityManager;
}

function projectExecFor(runtime: ProjectExecToolRuntime, authorityLeaseId?: string) {
  if (authorityLeaseId !== undefined) {
    const authority = runtime.authority.resolve(authorityLeaseId);
    return createScopedRuntime(runtime, authority).projectExec;
  }
  return createOpenRuntime(runtime).projectExec;
}

export function registerProjectExecTool(server: McpServer, runtime: ProjectExecToolRuntime): void {
  server.registerTool(
    "project_exec",
    {
      description: "Run one allowlisted command inside a fail-closed Docker sandbox scoped to the active scope root. Network is disabled and there is no host-execution fallback.",
      inputSchema: z.object({
        authorityLeaseId: z.string().min(40).optional(),
        command: z.string().min(1).max(256),
        args: z.array(z.string().max(65_536)).max(256).default([]),
        cwd: z.string().default("."),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      }).strict(),
      outputSchema: projectExecResultOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async ({ authorityLeaseId, command, args, cwd, timeoutMs }) => safeCall(() => projectExecFor(runtime, authorityLeaseId).run(
      command,
      args,
      cwd,
      timeoutMs ?? runtime.config.limits.commandTimeoutMs,
    )),
  );
}
