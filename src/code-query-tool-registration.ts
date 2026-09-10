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
      description: "Search current repository text or return lightweight current-file symbols. Honors Git ignore rules, excludes dependencies/build caches/binaries/obvious secrets, and returns current content hashes.",
      inputSchema: codeQueryInputSchema,
      outputSchema: codeQueryOutputSchema,
      annotations: codeQueryAnnotations,
    },
    async (input) => safeCall(async () => {
      const service = codeQueryFor(runtime, input.authorityLeaseId);
      if (input.operation === "search") {
        return service.search(input.query, input.cwd, input.maxResults);
      }
      return service.symbols(input.query ?? "", input.cwd, input.maxResults);
    }),
  );
}
