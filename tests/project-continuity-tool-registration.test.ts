import { describe, expect, it } from "vitest";
import { ContinuityNotFoundError } from "../src/continuity-errors.js";
import { projectContinuityResultOutputSchema, projectResumeOutputSchema } from "../src/continuity-output-schemas.js";
import {
  registerProjectContinuityTools,
  projectCheckpointInputSchema,
  projectContextReadInputSchema,
  projectRegisterInputSchema,
  projectResumeInputSchema,
} from "../src/project-continuity-tool-registration.js";

interface RegisteredTool {
  definition: {
    description?: string;
    inputSchema: { safeParse: (value: unknown) => { success: boolean } };
    outputSchema?: unknown;
    annotations?: Record<string, unknown>;
  };
  handler: (input: never) => Promise<unknown>;
}

function fakeRuntime() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const result = {
    projectId: "project-1",
    alias: "Project-X",
    recordVersion: 2,
    worktree: {
      canonicalPath: "/tmp/project-x",
      repositoryRoot: "/tmp/repository",
      commonGitDir: "/tmp/repository/.git",
      gitDir: "/tmp/repository/.git/worktrees/project-x",
      repositoryIdentity: "a".repeat(64),
      worktreeIdentity: "b".repeat(64),
    },
    localState: {
      checkedAt: "2026-09-11T02:40:00.000Z",
      branch: "feature/x",
      headSha: "c".repeat(40),
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      pathsTruncated: false,
    },
    publishedState: {
      remoteName: "origin" as const,
      branch: {
        status: "verified" as const,
        ref: "refs/heads/feature/x",
        currentSha: "d".repeat(40),
        checkedAt: "2026-09-11T02:40:00.000Z",
        lastVerifiedSha: "d".repeat(40),
        lastVerifiedAt: "2026-09-11T02:40:00.000Z",
      },
      main: {
        status: "unverified" as const,
        ref: "refs/heads/main",
        checkedAt: "2026-09-11T02:40:00.000Z",
        reason: "remote_error" as const,
      },
    },
    currentRecord: {
      recordVersion: 2,
      task: {
        goal: "Continue Project-X.",
        constraints: [],
        successCriteria: [],
        status: "active" as const,
        nextStep: "Wire the MCP tools.",
      },
      decisions: [],
      uncertainties: [],
      verificationSummary: [],
      createdAt: "2026-09-11T02:39:00.000Z",
    },
  };

  return {
    calls,
    continuity: {
      register: async (input: unknown) => { calls.push({ method: "register", input }); return result; },
      checkpoint: async (input: unknown) => { calls.push({ method: "checkpoint", input }); return result; },
      contextRead: async (input: unknown) => { calls.push({ method: "contextRead", input }); return result; },
      resume: async (input: unknown) => {
        calls.push({ method: "resume", input });
        return {
          projectId: "project-1",
          alias: "Project-X",
          recordVersion: 2,
          authorityLease: {
            leaseId: "L".repeat(43),
            profile: "project" as const,
            roots: ["/tmp/project-x"],
            terminalEnabled: false,
            commands: [],
            createdAt: "2026-09-11T02:40:00.000Z",
            expiresAt: "2026-09-11T02:42:00.000Z",
          },
          resumePackage: "PROJECT CONTINUITY v1",
          packageTruncated: false,
          contextAvailable: false,
        };
      },
    },
  };
}

function registerFixture() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, definition: RegisteredTool["definition"], handler: RegisteredTool["handler"]) {
      tools.set(name, { definition, handler });
    },
  };
  const runtime = fakeRuntime();
  registerProjectContinuityTools(server as never, runtime as never);
  return { tools, runtime };
}

function validTask() {
  return {
    goal: "Continue the registered project.",
    constraints: ["Preserve the exact worktree."],
    successCriteria: ["Resume by alias."],
    status: "active" as const,
    nextStep: "Register continuity tools.",
  };
}

describe("project continuity MCP registration", () => {
  it("registers exactly four strict continuity tools with the intended annotations and model guidance", () => {
    const { tools } = registerFixture();

    expect([...tools.keys()]).toEqual([
      "project_register",
      "project_resume",
      "project_checkpoint",
      "project_context_read",
    ]);
    expect(tools.get("project_register")?.definition.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools.get("project_resume")?.definition.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools.get("project_checkpoint")?.definition.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(tools.get("project_context_read")?.definition.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    expect(tools.get("project_resume")?.definition.description).toMatch(/continue.*registered project.*alias/i);
    expect(tools.get("project_resume")?.definition.description).toMatch(/never fuzzy/i);
    expect(tools.get("project_checkpoint")?.definition.description).toMatch(/direction changes|important decisions/i);
    expect(tools.get("project_checkpoint")?.definition.description).toMatch(/not automatically logged/i);
    expect(tools.get("project_context_read")?.definition.description).toMatch(/truncated|full current semantic record/i);

    expect(projectRegisterInputSchema.safeParse({
      alias: "Project-X",
      worktreePath: "/tmp/project-x",
      projectRoots: ["/tmp/project-x"],
      task: validTask(),
      unexpected: true,
    }).success).toBe(false);
    expect(projectResumeInputSchema.safeParse({ alias: "Project-X", unexpected: true }).success).toBe(false);
    expect(projectCheckpointInputSchema.safeParse({
      authorityLeaseId: "A".repeat(43),
      alias: "Project-X",
      expectedRecordVersion: 1,
      task: validTask(),
      decisions: [],
      unexpected: true,
    }).success).toBe(false);
    expect(projectContextReadInputSchema.safeParse({
      authorityLeaseId: "A".repeat(43),
      alias: "Project-X",
      recordVersion: 1,
    }).success).toBe(false);
  });

  it("enforces bounded semantic input sizes at the public schema", () => {
    expect(projectRegisterInputSchema.safeParse({
      alias: "x".repeat(129),
      worktreePath: "/tmp/project-x",
      projectRoots: ["/tmp/project-x"],
      task: validTask(),
    }).success).toBe(false);
    expect(projectRegisterInputSchema.safeParse({
      alias: "Project-X",
      worktreePath: "x".repeat(16_385),
      projectRoots: ["/tmp/project-x"],
      task: validTask(),
    }).success).toBe(false);
    expect(projectRegisterInputSchema.safeParse({
      alias: "Project-X",
      worktreePath: "/tmp/project-x",
      projectRoots: Array.from({ length: 17 }, (_, index) => `/tmp/project-${index}`),
      task: validTask(),
    }).success).toBe(false);
    expect(projectRegisterInputSchema.safeParse({
      alias: "Project-X",
      worktreePath: "/tmp/project-x",
      projectRoots: ["/tmp/project-x"],
      task: { ...validTask(), goal: "g".repeat(8_001) },
    }).success).toBe(false);
    expect(projectRegisterInputSchema.safeParse({
      alias: "Project-X",
      worktreePath: "/tmp/project-x",
      projectRoots: ["/tmp/project-x"],
      task: validTask(),
      decisions: Array.from({ length: 21 }, () => ({
        decision: "D",
        rationale: "R",
        alternatives: [],
        evidence: [],
      })),
    }).success).toBe(false);
  });

  it("serializes only safe public worktree fields and forwards validated service inputs", async () => {
    const { tools, runtime } = registerFixture();
    const register = tools.get("project_register");
    expect(register).toBeDefined();

    const result = await register!.handler({
      alias: "Project-X",
      worktreePath: "/tmp/project-x",
      projectRoots: ["/tmp/project-x"],
      task: validTask(),
      decisions: [],
    } as never) as {
      structuredContent?: Record<string, unknown>;
    };

    expect(runtime.calls).toEqual([{
      method: "register",
      input: {
        alias: "Project-X",
        worktreePath: "/tmp/project-x",
        projectRoots: ["/tmp/project-x"],
        task: validTask(),
        decisions: [],
      },
    }]);
    expect(result.structuredContent).toMatchObject({
      projectId: "project-1",
      alias: "Project-X",
      recordVersion: 2,
      worktree: {
        canonicalPath: "/tmp/project-x",
        repositoryRoot: "/tmp/repository",
        repositoryIdentity: "a".repeat(64),
        worktreeIdentity: "b".repeat(64),
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("commonGitDir");
    expect(JSON.stringify(result.structuredContent)).not.toContain("gitDir");
  });

  it("forwards resume checkpoint and context-read inputs and emits schema-valid public outputs", async () => {
    const { tools, runtime } = registerFixture();
    const resume = await tools.get("project_resume")!.handler({
      alias: "Project-X",
      requestedTtlSeconds: 120,
    } as never) as { structuredContent?: unknown };
    const checkpoint = await tools.get("project_checkpoint")!.handler({
      authorityLeaseId: "A".repeat(43),
      alias: "Project-X",
      expectedRecordVersion: 1,
      task: validTask(),
      decisions: [],
      uncertainties: ["Remote state may be stale."],
      verificationSummary: ["Focused test green."],
    } as never) as { structuredContent?: unknown };
    const context = await tools.get("project_context_read")!.handler({
      authorityLeaseId: "A".repeat(43),
      alias: "Project-X",
    } as never) as { structuredContent?: unknown };

    expect(projectResumeOutputSchema.safeParse(resume.structuredContent).success).toBe(true);
    expect(projectContinuityResultOutputSchema.safeParse(checkpoint.structuredContent).success).toBe(true);
    expect(projectContinuityResultOutputSchema.safeParse(context.structuredContent).success).toBe(true);
    expect(runtime.calls.slice(-3)).toEqual([
      { method: "resume", input: { alias: "Project-X", requestedTtlSeconds: 120 } },
      {
        method: "checkpoint",
        input: {
          authorityLeaseId: "A".repeat(43),
          alias: "Project-X",
          expectedRecordVersion: 1,
          task: validTask(),
          decisions: [],
          uncertainties: ["Remote state may be stale."],
          verificationSummary: ["Focused test green."],
        },
      },
      { method: "contextRead", input: { authorityLeaseId: "A".repeat(43), alias: "Project-X" } },
    ]);
  });

  it("preserves stable AppError codes but redacts unexpected internal error messages", async () => {
    const tools = new Map<string, RegisteredTool>();
    const server = {
      registerTool(name: string, definition: RegisteredTool["definition"], handler: RegisteredTool["handler"]) {
        tools.set(name, { definition, handler });
      },
    };
    registerProjectContinuityTools(server as never, {
      continuity: {
        register: async () => { throw new Error("database password=secret-internal"); },
        resume: async () => { throw new ContinuityNotFoundError(); },
        checkpoint: async () => { throw new Error("checkpoint-internal"); },
        contextRead: async () => { throw new Error("context-internal"); },
      },
    } as never);

    const registerResult = await tools.get("project_register")!.handler({
      alias: "Project-X",
      worktreePath: "/tmp/project-x",
      projectRoots: ["/tmp/project-x"],
      task: validTask(),
    } as never) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    const resumeResult = await tools.get("project_resume")!.handler({ alias: "Project-X" } as never) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };

    expect(registerResult.isError).toBe(true);
    expect(registerResult.content[0]?.text).toContain("INTERNAL_ERROR");
    expect(registerResult.content[0]?.text).not.toContain("password=secret-internal");
    expect(resumeResult.isError).toBe(true);
    expect(resumeResult.content[0]?.text).toContain("CONTINUITY_NOT_FOUND");
  });

});
