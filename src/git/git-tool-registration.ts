import { createProjectCheckService } from "../project/project-check-factory.js";
import { ProjectPublishGate } from "../project/project-publish-gate.js";
import { createOpenRuntime, createScopedRuntime } from "../core/scoped-runtime.js";
import type { RuntimeServices } from "../server.js";
import { READ_ONLY, WRITE, WRITE_IDEMPOTENT, WRITE_IDEMPOTENT_OPEN_WORLD } from "../mcp/tool-annotations.js";
import { gitResultOutputSchema, gitInventoryOutputSchema, gitFileReviewOutputSchema } from "../mcp/tool-output-schemas.js";
import { safeCall } from "../mcp/tool-result.js";
import { authorityLeaseField, withAuthority } from "../mcp/tool-scope.js";
import { assertWorkerAliasLive } from "../agent/worker-store.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function registerGitTools(server: McpServer, runtime: RuntimeServices): void {
  server.registerTool(
    "git_status",
    {
      description: "Read git status inside the active authority lease scope without running repository hooks or filesystem monitors.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default(".") }),
      outputSchema: gitResultOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, cwd }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.status(cwd)),
  );

  server.registerTool(
    "git_inventory",
    {
      description: "Return a complete, categorized Git worktree inventory with cursor pagination. Modified, untracked, deleted, and ignored paths remain distinct; this read does not stage or mutate anything.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), cursor: z.number().int().nonnegative().default(0), snapshot: z.string().regex(/^[a-f0-9]{64}$/).optional(), pageSize: z.number().int().min(1).max(200).default(100) }).strict(),
      outputSchema: gitInventoryOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, cwd, cursor, snapshot, pageSize }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.inventory(cwd, cursor, pageSize, snapshot)),
  );

  server.registerTool(
    "git_file_review",
    {
      description: "Review one explicit repository-relative file diff without staging or changing the worktree. Deleted files remain reviewable by path.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), path: z.string().min(1) }).strict(),
      outputSchema: gitFileReviewOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, cwd, path: filePath }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.fileReview(cwd, filePath)),
  );

  server.registerTool(
    "git_diff",
    {
      description: "Read a git diff or check it for whitespace errors inside the active authority lease scope with external diff/textconv disabled. Set check=true for git diff --check; combine with staged=true for git diff --cached --check. Nonzero exitCode means the check found errors.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), staged: z.boolean().default(false), check: z.boolean().default(false) }),
      outputSchema: gitResultOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, cwd, staged, check }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.diff(cwd, staged, check)),
  );

  server.registerTool(
    "git_log",
    {
      description: "Read recent git commits inside the active authority lease scope without running repository hooks or interactive prompts.",
      inputSchema: z.object({ ...authorityLeaseField, cwd: z.string().default("."), limit: z.number().int().min(1).max(100).default(20) }),
      outputSchema: gitResultOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, cwd, limit }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.log(cwd, limit)),
  );

  server.registerTool(
    "git_create_branch",
    {
      description: "Create and switch to one validated local Git branch inside the active authority scope. Arbitrary Git arguments, hooks, and remote changes are not exposed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        branch: z.string().min(1).max(200),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: WRITE,
    },
    async ({ authorityLeaseId, cwd, branch }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.createBranch(cwd, branch)),
  );

  server.registerTool(
    "git_switch_branch",
    {
      description: "Switch to one validated existing local Git branch inside the active authority scope. No arbitrary checkout arguments are accepted.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        branch: z.string().min(1).max(200),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, cwd, branch }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.switchBranch(cwd, branch)),
  );

  server.registerTool(
    "git_stage_paths",
    {
      description: "Stage 1-100 explicit file paths inside the selected repository directory after authority-scope validation. Directory-wide and out-of-scope path staging are rejected.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        paths: z.array(z.string().min(1)).min(1).max(100),
        expectedSha256: z.record(z.string(), z.union([z.string().regex(/^[a-f0-9]{64}$/), z.literal("deleted")])).optional(),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, cwd, paths, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.stagePaths(cwd, paths, expectedSha256)),
  );

  server.registerTool(
    "git_commit",
    {
      description: "Create one local Git commit from the existing index with a bounded commit message. Repository hooks and GPG signing are disabled for this operation.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        message: z.string().min(1).max(500),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: WRITE,
    },
    async ({ authorityLeaseId, cwd, message }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.commit(cwd, message)),
  );

  server.registerTool(
    "git_merge_branch",
    {
      description: "Merge one validated local branch into the current branch with --no-ff and --no-edit. No arbitrary merge options are accepted.",
      inputSchema: z.object({
        ...authorityLeaseField,
        cwd: z.string().default("."),
        branch: z.string().min(1).max(200),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: WRITE,
    },
    async ({ authorityLeaseId, cwd, branch }) => safeCall(() => withAuthority(runtime, authorityLeaseId).git.mergeBranch(cwd, branch)),
  );

  server.registerTool(
    "git_push",
    {
      description: "Push only a clean, fresh locally verified non-main branch from the exact active project_resume worktree to the existing credential-free GitHub origin. Requires the resumed Project authority lease; force, remote, refspec, branch, head, and verification overrides are not exposed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        projectAuthorityLeaseId: z.string().min(40),
        cwd: z.string().default("."),
      }).strict(),
      outputSchema: gitResultOutputSchema,
      annotations: WRITE_IDEMPOTENT_OPEN_WORLD,
    },
    async ({ authorityLeaseId, projectAuthorityLeaseId, cwd }) => safeCall(async () => {
      const projectAuthority = runtime.authority.resolve(projectAuthorityLeaseId);
      const resumeContext = await runtime.continuity.revalidateResumeContext(projectAuthorityLeaseId);
      await assertWorkerAliasLive(
        {
          taskStateRoot: runtime.taskStateRoot,
          audit: runtime.audit,
          maxWorkers: runtime.config.workers.maxWorkers,
          maxParkedRuns: runtime.config.workers.maxParkedRuns,
        },
        resumeContext.alias,
      );
      const leaseScoped = authorityLeaseId !== undefined
        ? createScopedRuntime(runtime, runtime.authority.resolve(authorityLeaseId))
        : createOpenRuntime(runtime);
      const projectScoped = createScopedRuntime(runtime, projectAuthority);
      const projectCheck = createProjectCheckService(runtime, projectAuthorityLeaseId);
      const gate = new ProjectPublishGate({
        projectGit: projectScoped.git,
        adminGit: leaseScoped.git,
        projectCheck,
      });
      return gate.push({ cwd, resumeContext });
    }),
  );
}
