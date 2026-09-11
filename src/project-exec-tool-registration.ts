import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import { errorPayload } from "./errors.js";
import { createScopedRuntime, type ScopedRuntimeBase } from "./scoped-runtime.js";
import { projectExecResultOutputSchema } from "./tool-output-schemas.js";

export interface ProjectExecToolRuntime extends ScopedRuntimeBase {
  authority: AuthorityManager;
}

const projectExecAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

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

function projectExecFor(runtime: ProjectExecToolRuntime, authorityLeaseId: string) {
  const authority = runtime.authority.resolve(authorityLeaseId);
  return createScopedRuntime(runtime, authority).projectExec;
}

export function registerProjectExecTool(server: McpServer, runtime: ProjectExecToolRuntime): void {
  server.registerTool(
    "project_exec",
    {
      description: "Run one allowlisted command inside a fail-closed Docker sandbox scoped to an active Project authority root. Network is disabled and there is no host-execution fallback.",
      inputSchema: z.object({
        authorityLeaseId: z.string().min(40),
        command: z.string().min(1).max(256),
        args: z.array(z.string().max(65_536)).max(256).default([]),
        cwd: z.string().default("."),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      }).strict(),
      outputSchema: projectExecResultOutputSchema,
      annotations: projectExecAnnotations,
    },
    async ({ authorityLeaseId, command, args, cwd, timeoutMs }) => safeCall(() => projectExecFor(runtime, authorityLeaseId).run(
      command,
      args,
      cwd,
      timeoutMs ?? runtime.config.limits.commandTimeoutMs,
    )),
  );
}
