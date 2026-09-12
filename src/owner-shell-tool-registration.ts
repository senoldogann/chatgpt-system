import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { OWNER_SHELL_MAX_SCRIPT_BYTES } from "./config.js";
import { AppError } from "./errors.js";
import { createScopedRuntime } from "./scoped-runtime.js";
import type { RuntimeServices } from "./server.js";
import { shellRunOutputSchema } from "./tool-output-schemas.js";

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
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

function safeErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { error: error.code, message: error.message };
  return { error: "SHELL_FAILED", message: "Owner shell execution failed." };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(safeErrorPayload(error)), isError: true };
  }
}

export function registerOwnerShellTool(server: McpServer, runtime: RuntimeServices): void {
  server.registerTool(
    "shell_run",
    {
      description: "Run arbitrary full-host login-shell syntax as the current user inside a locally approved Admin Owner Runtime session. This is not OS-sandboxed.",
      inputSchema: z.object({
        authorityLeaseId: z.string().min(40),
        script: z.string().min(1).max(runtime.config.ownerRuntime?.maxScriptBytes ?? OWNER_SHELL_MAX_SCRIPT_BYTES),
        cwd: z.string().min(1).max(16_384).optional(),
        timeoutMs: z.number().int().positive().nullable().optional(),
      }).strict(),
      outputSchema: shellRunOutputSchema,
      annotations: mutationAnnotations,
    },
    async ({ authorityLeaseId, script, cwd, timeoutMs }, ctx) => safeCall(() => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).shell.run({
        script,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
      });
    }),
  );
}
