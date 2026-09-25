import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "../core/authority.js";
import { createOpenRuntime, createScopedRuntime, type ScopedRuntimeBase } from "../core/scoped-runtime.js";
import { codeQueryOutputSchema } from "../mcp/tool-output-schemas.js";
import { safeCall } from "../mcp/tool-result.js";
import { READ_ONLY } from "../mcp/tool-annotations.js";

export interface CodeQueryToolRuntime extends ScopedRuntimeBase {
  authority: AuthorityManager;
}

const baseFields = {
  authorityLeaseId: z.string().min(40).optional(),
  cwd: z.string().default("."),
  maxResults: z.number().int().min(1).max(200).optional(),
};

const codeQueryInputSchema = z.discriminatedUnion("operation", [
  z.object({
    ...baseFields,
    operation: z.literal("search"),
    query: z.string().min(1).max(4_096),
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    glob: z.string().min(1).max(1_024).optional(),
    contextLines: z.number().int().min(0).max(5).optional(),
  }).strict(),
  z.object({
    ...baseFields,
    operation: z.literal("files"),
    glob: z.string().min(1).max(1_024).optional(),
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

function codeQueryFor(runtime: CodeQueryToolRuntime, authorityLeaseId?: string) {
  if (authorityLeaseId !== undefined) {
    const authority = runtime.authority.resolve(authorityLeaseId);
    return createScopedRuntime(runtime, authority).codeQuery;
  }
  return createOpenRuntime(runtime).codeQuery;
}

export function registerCodeQueryTool(server: McpServer, runtime: CodeQueryToolRuntime): void {
  server.registerTool(
    "code_query",
    {
      description: "Query current repository code. search: bounded text or regex search (case-insensitive by default) with optional path glob and 0-5 context lines. files: list repository files matching a glob (e.g. src/**/*.ts; a pattern without '/' matches file names at any depth). symbols: lightweight declarations. definition/references/diagnostics: TypeScript semantic operations that fail explicitly with LSP_UNAVAILABLE when unsupported. Results follow .gitignore and skip binary, secret-looking and dependency paths.",
      inputSchema: codeQueryInputSchema,
      outputSchema: codeQueryOutputSchema,
      annotations: READ_ONLY,
    },
    async (input) => safeCall(async () => {
      const service = codeQueryFor(runtime, input.authorityLeaseId);
      if (input.operation === "search") {
        return service.search(input.query, input.cwd, input.maxResults, {
          ...(input.regex !== undefined ? { regex: input.regex } : {}),
          ...(input.caseSensitive !== undefined ? { caseSensitive: input.caseSensitive } : {}),
          ...(input.glob !== undefined ? { glob: input.glob } : {}),
          ...(input.contextLines !== undefined ? { contextLines: input.contextLines } : {}),
        });
      }
      if (input.operation === "files") {
        return service.files(input.glob, input.cwd, input.maxResults);
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
