import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuditLogger } from "../core/audit.js";
import type { AuthorityManager } from "../core/authority.js";
import { COMPUTER_MAX_EXPLICIT_RUNTIME_MS } from "../core/config.js";
import type { ComputerJsRuntime } from "./computer-js-runtime.js";
import { AppError } from "../core/errors.js";
import { ScopedComputerJsService } from "./scoped-computer-js-service.js";
import { computerJsRunOutputSchema } from "../mcp/tool-output-schemas.js";
import { createSafeCall } from "../mcp/tool-result.js";
import { DESTRUCTIVE_OPEN_WORLD } from "../mcp/tool-annotations.js";

export interface ComputerJsToolRuntime {
  config: {
    ownerRuntime?: { enabled: boolean };
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

const authorityLeaseField = { authorityLeaseId: z.string().min(40).optional() };

function safeErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { error: error.code, message: error.message };
  return { error: "INTERNAL_ERROR", message: "Full-host computer JavaScript failed." };
}

const safeCall = createSafeCall(safeErrorPayload);

function computerJsFor(runtime: ComputerJsToolRuntime, authorityLeaseId?: string): ScopedComputerJsService {
  // Verilen lease varsa doğrulanır, yoksa açık kapsam kullanılır.
  if (authorityLeaseId !== undefined) runtime.authority.resolve(authorityLeaseId);
  return new ScopedComputerJsService(
    runtime.computerJs,
    runtime.audit,
    true,
    runtime.config.computerUse.fullHostJsEnabled === true,
  );
}

export function registerComputerJsTools(server: McpServer, runtime: ComputerJsToolRuntime): void {
  const timeoutSchema = runtime.config.ownerRuntime?.enabled === true
    ? z.number().int().positive().max(COMPUTER_MAX_EXPLICIT_RUNTIME_MS)
    : z.number().int().positive().max(runtime.config.computerUse.maxJsRuntimeMs);
  server.registerTool(
    "computer_run_js",
    {
      description: "Run bounded owner-trust JavaScript as the current user with normal Node APIs and the low-level computer proxy. No lease required. This execution is not OS-sandboxed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        source: z.string().max(runtime.config.computerUse.maxJsSourceBytes),
        cwd: z.string().min(1).max(16_384).optional(),
        timeoutMs: timeoutSchema.optional(),
      }).strict(),
      outputSchema: computerJsRunOutputSchema,
      annotations: DESTRUCTIVE_OPEN_WORLD,
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
