import { PROJECT_EXEC_IMAGE } from "./docker-project-exec-backend.js";
import type { RuntimeServices } from "./server.js";
import { describeSystemEnvironment } from "./system-environment.js";
import { DESTRUCTIVE_IDEMPOTENT, READ_ONLY, WRITE } from "./tool-annotations.js";
import {
  authorityEndOutputSchema,
  authorityLeaseOutputSchema,
  systemCapabilitiesOutputSchema,
  systemEnvironmentOutputSchema,
} from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const projectAuthorityStartInputSchema = z.object({
  profile: z.literal("project").optional(),
  projectRoots: z.array(z.string()).min(1),
  requestedTtlSeconds: z.coerce.number().int().positive().optional(),
});
type AuthorityStartInput = z.infer<typeof projectAuthorityStartInputSchema>;

export function registerSystemTools(server: McpServer, runtime: RuntimeServices): void {
  const authorityStartInputSchema = projectAuthorityStartInputSchema;

  server.registerTool(
    "system_capabilities",
    {
      description: "Show bootstrap filesystem roots, safety limits, audit path, and startup terminal configuration. Bootstrap roots are defaults only: Project leases may target other explicit project directories outside bootstrap roots, while filesystem root and the entire home directory remain forbidden for Project authority.",
      inputSchema: z.object({}),
      outputSchema: systemCapabilitiesOutputSchema,
      annotations: READ_ONLY,
    },
    async () => safeCall(async () => ({
      roots: runtime.config.roots,
      projectAuthority: {
        bootstrapRootsAreDefaultsOnly: true as const,
        dynamicProjectRootsSupported: true as const,
        forbiddenBroadRoots: ["filesystem-root", "home-directory"] as const,
        recommendedOpenFlow: ["session_authority_start", "project_register", "project_resume"] as const,
      },
      auditFile: runtime.config.auditFile,
      terminal: runtime.config.terminal,
      ownerRuntime: {
        enabled: runtime.config.ownerRuntime?.enabled === true,
      },
      skills: {
        enabled: runtime.config.skills.enabled,
      },
      goal: {
        enabled: runtime.config.goal.enabled,
      },
      workers: {
        enabled: runtime.config.workers.enabled,
        maxWorkers: runtime.config.workers.maxWorkers,
      },
      computerUse: {
        enabled: runtime.config.computerUse?.enabled === true,
        fullHostJsEnabled: runtime.config.computerUse?.fullHostJsEnabled === true,
      },
      projectExecution: {
        enabled: runtime.config.projectExec.enabled,
        sandboxed: true as const,
        backend: "docker" as const,
        network: "none" as const,
        hostFallback: false as const,
        image: PROJECT_EXEC_IMAGE,
      },
      limits: runtime.config.limits,
      safety: {
        filesystemConfinement: true as const,
        symlinkEscapeProtection: true as const,
        writeConflictProtection: "optimistic-sha256" as const,
        atomicFileReplacement: true as const,
        linearizableExternalWriterCAS: false as const,
        hostileLocalFilesystemRaceProtection: false as const,
        terminalOsSandboxed: false as const,
      },
    })),
  );

  server.registerTool(
    "system_environment",
    {
      description: "Describe the local runtime environment without running terminal commands. Bootstrap roots are defaults only: Project leases may target other explicit project directories outside bootstrap roots. Read-only; exposes no secret values.",
      inputSchema: z.object({}),
      outputSchema: systemEnvironmentOutputSchema,
      annotations: READ_ONLY,
    },
    async () => safeCall(async () => describeSystemEnvironment(runtime.config)),
  );

  server.registerTool(
    "session_authority_start",
    {
      description: "Start a Project lease for explicit project roots, including project directories outside bootstrap roots. The lease is optional scoping: every tool also works without authorityLeaseId against the bootstrap roots. For a new project: start the exact Project lease, project_register once for continuity, then use project_resume in later chats. Filesystem root and the entire home directory are refused for Project authority.",
      inputSchema: authorityStartInputSchema,
      outputSchema: authorityLeaseOutputSchema,
      annotations: WRITE,
    },
    async (input: AuthorityStartInput) => safeCall(async () => {
      const lease = await runtime.authority.start({
        profile: "project",
        projectRoots: input.projectRoots,
        ...(input.requestedTtlSeconds !== undefined
          ? { requestedTtlSeconds: input.requestedTtlSeconds }
          : {}),
      });
      await runtime.authority.flushAudit();
      return lease;
    }),
  );

  server.registerTool(
    "session_authority_status",
    {
      description: "Inspect an active authority lease without changing it.",
      inputSchema: z.object({ authorityLeaseId: z.string().min(40) }),
      outputSchema: authorityLeaseOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId }) => safeCall(async () => runtime.authority.status(authorityLeaseId)),
  );

  server.registerTool(
    "session_authority_end",
    {
      description: "Revoke an active authority lease immediately. The same leaseId cannot be used again.",
      inputSchema: z.object({ authorityLeaseId: z.string().min(40) }),
      outputSchema: authorityEndOutputSchema,
      annotations: DESTRUCTIVE_IDEMPOTENT,
    },
    async ({ authorityLeaseId }) => safeCall(async () => {
      const result = runtime.authority.end(authorityLeaseId);
      await runtime.authority.flushAudit();
      return result;
    }),
  );
}
