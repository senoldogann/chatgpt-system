import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuditLogger } from "./audit.js";
import type { AuthorityManager } from "./authority.js";
import type { ComputerJsRuntime } from "./computer-js-runtime.js";
import { AppError } from "./errors.js";
import { ScopedComputerJsService } from "./scoped-computer-js-service.js";
import { computerJsRunOutputSchema } from "./tool-output-schemas.js";

export interface ComputerJsToolRuntime {
  config: {
    computerUse: {
      fullHostJsEnabled: boolean;
      maxJsSourceBytes: number;
      maxJsRuntimeMs: number;
    };
  };
  authority: AuthorityManager;
  audit: AuditLogger;
  computerJs: ComputerJsRuntime;
}

const authorityLeaseField = { authorityLeaseId: z.string().min(40) };
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
  return { error: "INTERNAL_ERROR", message: "Full-host computer JavaScript failed." };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(safeErrorPayload(error)), isError: true };
  }
}

function computerJsFor(runtime: ComputerJsToolRuntime, authorityLeaseId: string): ScopedComputerJsService {
  const authority = runtime.authority.resolve(authorityLeaseId);
  return new ScopedComputerJsService(
    runtime.computerJs,
    runtime.audit,
    authority.profile === "admin",
    runtime.config.computerUse.fullHostJsEnabled === true,
  );
}

export function registerComputerJsTools(server: McpServer, runtime: ComputerJsToolRuntime): void {
  server.registerTool(
    "computer_run_js",
    {
      description: "Run bounded owner-trust JavaScript as the current user with normal Node APIs and the low-level computer proxy. Requires Admin authority. This execution is not OS-sandboxed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        source: z.string().max(runtime.config.computerUse.maxJsSourceBytes),
        cwd: z.string().min(1).max(16_384).optional(),
        timeoutMs: z.number().int().positive().max(runtime.config.computerUse.maxJsRuntimeMs).optional(),
      }).strict(),
      outputSchema: computerJsRunOutputSchema,
      annotations: mutationAnnotations,
    },
    async ({ authorityLeaseId, source, cwd, timeoutMs }, ctx) => safeCall(() =>
      computerJsFor(runtime, authorityLeaseId).run({
        source,
        ...(cwd !== undefined ? { cwd } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(ctx.mcpReq.signal ? { signal: ctx.mcpReq.signal } : {}),
      }),
    ),
  );
}
