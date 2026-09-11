import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { errorPayload } from "./errors.js";
import { PatchSetService } from "./patch-set-service.js";
import { PathPolicy } from "./policy.js";
import { fsPatchSetOutputSchema } from "./tool-output-schemas.js";

export interface PatchSetToolRuntime {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  taskStateRoot: string;
}

const annotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const patchInputSchema = z.object({
  path: z.string().min(1).max(8_192),
  patch: z.string().min(1).max(4 * 1024 * 1024),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

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

export function registerPatchSetTool(server: McpServer, runtime: PatchSetToolRuntime): void {
  server.registerTool(
    "fs_apply_patch_set",
    {
      description: "Validate and apply 1-100 SHA-256 guarded unified patches as one recoverable multi-file transaction inside the active authority scope. Normal validation failures leave every destination unchanged.",
      inputSchema: z.object({
        authorityLeaseId: z.string().min(40),
        patches: z.array(patchInputSchema).min(1).max(100),
      }).strict(),
      outputSchema: fsPatchSetOutputSchema,
      annotations,
    },
    async ({ authorityLeaseId, patches }) => safeCall(async () => {
      const authority = runtime.authority.resolve(authorityLeaseId);
      const service = new PatchSetService(
        new PathPolicy([...authority.roots]),
        runtime.audit,
        runtime.taskStateRoot,
        runtime.config.limits,
      );
      return service.apply(patches);
    }),
  );
}
