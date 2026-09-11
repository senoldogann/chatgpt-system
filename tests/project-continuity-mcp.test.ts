import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler, type NodeIncomingMessageLike, type NodeServerResponseLike } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { ContinuityNotFoundError } from "../src/continuity-errors.js";
import { registerProjectContinuityTools } from "../src/project-continuity-tool-registration.js";

const servers: Server[] = [];

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

function task() {
  return {
    goal: "Continue Project-X.",
    constraints: ["Preserve exact worktree identity."],
    successCriteria: ["Resume by alias."],
    status: "active" as const,
    nextStep: "Wire continuity into the shared runtime.",
  };
}

function continuityResult() {
  return {
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
      checkedAt: "2026-09-11T05:30:00.000Z",
      branch: "feature/x",
      headSha: "c".repeat(40),
      stagedPaths: [],
      unstagedPaths: ["src/example.ts"],
      untrackedPaths: [],
      pathsTruncated: false,
    },
    publishedState: {
      remoteName: "origin" as const,
      branch: {
        status: "verified" as const,
        ref: "refs/heads/feature/x",
        currentSha: "d".repeat(40),
        checkedAt: "2026-09-11T05:30:00.000Z",
        lastVerifiedSha: "d".repeat(40),
        lastVerifiedAt: "2026-09-11T05:30:00.000Z",
      },
      main: {
        status: "unverified" as const,
        ref: "refs/heads/main",
        checkedAt: "2026-09-11T05:30:00.000Z",
        reason: "remote_error" as const,
      },
    },
    currentRecord: {
      recordVersion: 2,
      task: task(),
      decisions: [],
      uncertainties: ["Origin could not be verified."],
      verificationSummary: ["Focused continuity tests are green."],
      createdAt: "2026-09-11T05:29:00.000Z",
    },
  };
}

function runtime() {
  const calls: Array<{ method: string; input: unknown }> = [];
  return {
    calls,
    continuity: {
      register: async (input: unknown) => {
        calls.push({ method: "register", input });
        return continuityResult();
      },
      checkpoint: async (input: unknown) => {
        calls.push({ method: "checkpoint", input });
        return continuityResult();
      },
      contextRead: async (input: unknown) => {
        calls.push({ method: "contextRead", input });
        return continuityResult();
      },
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
            createdAt: "2026-09-11T05:30:00.000Z",
            expiresAt: "2026-09-11T05:32:00.000Z",
          },
          resumePackage: "PROJECT CONTINUITY v1\nnextStep: Wire continuity into the shared runtime.",
          packageTruncated: false,
          contextAvailable: false,
        };
      },
    },
  };
}

async function fixture(customRuntime = runtime()) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "project-continuity-test", version: "1.0.0" });
    registerProjectContinuityTools(server, customRuntime as never);
    return server;
  }, {
    legacy: "stateless",
  });
  const nodeHandler = toNodeHandler(handler);
  const server = createServer((req, res) => {
    void nodeHandler(
      req as unknown as NodeIncomingMessageLike,
      res as unknown as NodeServerResponseLike,
    );
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "project-continuity-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  await client.connect(transport);
  return { client, transport, runtime: customRuntime };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("project continuity real MCP protocol", () => {
  it("lists exactly four continuity tools and returns structured Project resume output", async () => {
    const { client, transport, runtime: fakeRuntime } = await fixture();
    try {
      const { tools } = await client.listTools();
      const continuityTools = tools.filter((tool) => tool.name.startsWith("project_"));
      expect(continuityTools.map((tool) => tool.name).sort()).toEqual([
        "project_checkpoint",
        "project_context_read",
        "project_register",
        "project_resume",
      ]);
      for (const tool of continuityTools) {
        expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
        expect(tool.outputSchema).toMatchObject({ type: "object", additionalProperties: false });
      }

      const result = await client.callTool({
        name: "project_resume",
        arguments: { alias: "Project-X", requestedTtlSeconds: 120 },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        projectId: "project-1",
        alias: "Project-X",
        recordVersion: 2,
        authorityLease: {
          profile: "project",
          terminalEnabled: false,
          roots: ["/tmp/project-x"],
        },
        packageTruncated: false,
        contextAvailable: false,
      });
      expect(JSON.stringify(result.structuredContent)).not.toContain("commonGitDir");
      expect(JSON.stringify(result.structuredContent)).not.toContain("gitDir");
      expect(fakeRuntime.calls).toEqual([
        { method: "resume", input: { alias: "Project-X", requestedTtlSeconds: 120 } },
      ]);
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("rejects unknown input fields before service work and redacts unexpected internal errors", async () => {
    const fakeRuntime = runtime();
    fakeRuntime.continuity.register = async () => {
      throw new Error("database-password=do-not-leak");
    };
    fakeRuntime.continuity.resume = async () => {
      throw new ContinuityNotFoundError();
    };
    const { client, transport } = await fixture(fakeRuntime);
    try {
      const invalid = await client.callTool({
        name: "project_checkpoint",
        arguments: {
          authorityLeaseId: "A".repeat(43),
          alias: "Project-X",
          expectedRecordVersion: 2,
          task: task(),
          decisions: [],
          unexpected: true,
        },
      });
      expect(invalid.isError).toBe(true);
      expect(fakeRuntime.calls).toHaveLength(0);

      const internal = await client.callTool({
        name: "project_register",
        arguments: {
          alias: "Project-X",
          worktreePath: "/tmp/project-x",
          projectRoots: ["/tmp/project-x"],
          task: task(),
        },
      });
      expect(internal.isError).toBe(true);
      expect(textContent(internal)).toContain("INTERNAL_ERROR");
      expect(textContent(internal)).not.toContain("database-password=do-not-leak");

      const stable = await client.callTool({
        name: "project_resume",
        arguments: { alias: "Project-X" },
      });
      expect(stable.isError).toBe(true);
      expect(textContent(stable)).toContain("CONTINUITY_NOT_FOUND");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
