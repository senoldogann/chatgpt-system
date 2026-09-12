import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { AppError } from "./errors.js";
import { createScopedRuntime } from "./scoped-runtime.js";
import type { RuntimeServices } from "./server.js";
import {
  terminalSessionListOutputSchema,
  terminalSessionReadOutputSchema,
  terminalSessionSummaryOutputSchema,
} from "./tool-output-schemas.js";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const openAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const writeAnnotations = openAnnotations;

const resizeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const closeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
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
  return { error: "TERMINAL_SESSION_FAILED", message: "Terminal session operation failed." };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(safeErrorPayload(error)), isError: true };
  }
}

const lease = { authorityLeaseId: z.string().min(40) };
const sessionId = { sessionId: z.string().min(40).max(128) };
const dimension = z.number().int().min(1).max(1000);

export function registerTerminalSessionTools(server: McpServer, runtime: RuntimeServices): void {
  server.registerTool(
    "terminal_session_open",
    {
      description: "Open one persistent unrestricted Owner Runtime PTY using the trusted configured login shell. Requires an Admin authority lease and does not expose the native PID.",
      inputSchema: z.object({
        ...lease,
        cwd: z.string().min(1).max(16_384).optional(),
        cols: dimension.optional(),
        rows: dimension.optional(),
      }).strict(),
      outputSchema: terminalSessionSummaryOutputSchema,
      annotations: openAnnotations,
    },
    async ({ authorityLeaseId, cwd, cols, rows }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).terminals.open({
        ...(cwd !== undefined ? { cwd } : {}),
        ...(cols !== undefined ? { cols } : {}),
        ...(rows !== undefined ? { rows } : {}),
      });
    }),
  );

  server.registerTool(
    "terminal_session_read",
    {
      description: "Read bounded in-memory PTY output after an opaque monotonic sequence cursor. PTY content is not persisted to audit.",
      inputSchema: z.object({
        ...lease,
        ...sessionId,
        afterSequence: z.number().int().nonnegative().optional(),
      }).strict(),
      outputSchema: terminalSessionReadOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId, sessionId: id, afterSequence }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).terminals.read(id, afterSequence ?? 0);
    }),
  );

  server.registerTool(
    "terminal_session_write",
    {
      description: "Write bounded UTF-8 input to one persistent Owner Runtime PTY. This can execute arbitrary terminal activity as the current user.",
      inputSchema: z.object({
        ...lease,
        ...sessionId,
        data: z.string().min(1).max(runtime.config.ownerRuntime?.maxTerminalInputBytes ?? 65_536),
      }).strict(),
      outputSchema: terminalSessionSummaryOutputSchema,
      annotations: writeAnnotations,
    },
    async ({ authorityLeaseId, sessionId: id, data }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).terminals.write(id, data);
    }),
  );

  server.registerTool(
    "terminal_session_resize",
    {
      description: "Resize one running Owner Runtime PTY. Native terminal identifiers and signals are not caller-controlled.",
      inputSchema: z.object({
        ...lease,
        ...sessionId,
        cols: dimension,
        rows: dimension,
      }).strict(),
      outputSchema: terminalSessionSummaryOutputSchema,
      annotations: resizeAnnotations,
    },
    async ({ authorityLeaseId, sessionId: id, cols, rows }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).terminals.resize(id, cols, rows);
    }),
  );

  server.registerTool(
    "terminal_session_close",
    {
      description: "Idempotently close one manageable Owner Runtime PTY. The daemon chooses process-group termination and escalation internally.",
      inputSchema: z.object({ ...lease, ...sessionId }).strict(),
      outputSchema: terminalSessionSummaryOutputSchema,
      annotations: closeAnnotations,
    },
    async ({ authorityLeaseId, sessionId: id }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).terminals.close(id);
    }),
  );

  server.registerTool(
    "terminal_session_list",
    {
      description: "List daemon-owned terminal sessions visible to the active Admin Owner Runtime scope. Raw OS process identifiers are never returned.",
      inputSchema: z.object(lease).strict(),
      outputSchema: terminalSessionListOutputSchema,
      annotations: readAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      return createScopedRuntime(runtime, authority).terminals.list();
    }),
  );
}
