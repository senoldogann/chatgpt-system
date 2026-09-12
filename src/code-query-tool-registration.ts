import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import { errorPayload } from "./errors.js";
import { createScopedRuntime, type ScopedRuntimeBase } from "./scoped-runtime.js";
import { codeQueryOutputSchema } from "./tool-output-schemas.js";

export interface CodeQueryToolRuntime extends ScopedRuntimeBase {
  authority: AuthorityManager;
}

const codeQueryAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const baseFields = {
  authorityLeaseId: z.string().min(40),
  cwd: z.string().default("."),
  maxResults: z.number().int().min(1).max(200).optional(),
};

const codeQueryInputSchema = z.discriminatedUnion("operation", [
  z.object({
    ...baseFields,
    operation: z.literal("search"),
    query: z.string().min(1).max(4_096),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("symbols"),
    query: z.string().max(4_096).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("definition"),
    path: z.string().min(1).max(8_192),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("references"),
    path: z.string().min(1).max(8_192),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("diagnostics"),
    path: z.string().min(1).max(8_192),
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

function codeQueryFor(runtime: CodeQueryToolRuntime, authorityLeaseId: string) {
  const authority = runtime.authority.resolve(authorityLeaseId);
  return createScopedRuntime(runtime, authority).codeQuery;
}

export function registerCodeQueryTool(server: McpServer, runtime: CodeQueryToolRuntime): void {
  server.registerTool(
    "code_query",
    {
      description: "Query current repository code with bounded text search, lightweight symbols, or TypeScript semantic definition/reference/diagnostic operations. Semantic operations fail explicitly with LSP_UNAVAILABLE when unsupported.",
      inputSchema: codeQueryInputSchema,
      outputSchema: codeQueryOutputSchema,
      annotations: codeQueryAnnotations,
    },
    async (input) => safeCall(async () => {
      const service = codeQueryFor(runtime, input.authorityLeaseId);
      if (input.operation === "search") {
        return service.search(input.query, input.cwd, input.maxResults);
      }
      if (input.operation === "symbols") {
        return service.symbols(input.query ?? "", input.cwd, input.maxResults);
      }
      if (input.operation === "definition") {
        return service.definition(input.path, input.line, input.column, input.cwd, input.maxResults);
      }
      if (input.operation === "references") {
        return service.references(input.path, input.line, input.column, input.cwd, input.maxResults);
      }
      return service.diagnostics(input.path, input.cwd, input.maxResults);
    }),
  );
}
