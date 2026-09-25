import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "../core/authority.js";
import type { AuditLogger } from "../core/audit.js";
import type { AppConfig } from "../core/config.js";
import { PatchSetService } from "./patch-set-service.js";
import { PathPolicy } from "../core/policy.js";
import { fsPatchSetOutputSchema } from "../mcp/tool-output-schemas.js";
import { safeCall } from "../mcp/tool-result.js";
import { DESTRUCTIVE } from "../mcp/tool-annotations.js";

export interface PatchSetToolRuntime {
  authority: AuthorityManager;
  audit: AuditLogger;
  config: AppConfig;
  taskStateRoot: string;
}

const patchInputSchema = z.object({
  path: z.string().min(1).max(8_192),
  patch: z.string().min(1).max(4 * 1024 * 1024),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function registerPatchSetTool(server: McpServer, runtime: PatchSetToolRuntime): void {
  server.registerTool(
    "fs_apply_patch_set",
    {
      description: "Validate and apply 1-100 SHA-256 guarded unified patches as one recoverable multi-file transaction inside the active scope. Normal validation failures leave every destination unchanged.",
      inputSchema: z.object({
        authorityLeaseId: z.string().min(40).optional(),
        patches: z.array(patchInputSchema).min(1).max(100),
      }).strict(),
      outputSchema: fsPatchSetOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async ({ authorityLeaseId, patches }) => safeCall(async () => {
      const roots = authorityLeaseId === undefined
        ? [...runtime.config.roots]
        : [...runtime.authority.resolve(authorityLeaseId).roots];
      const service = new PatchSetService(
        new PathPolicy(roots),
        runtime.audit,
        runtime.taskStateRoot,
        runtime.config.limits,
      );
      return service.apply(patches);
    }),
  );
}
