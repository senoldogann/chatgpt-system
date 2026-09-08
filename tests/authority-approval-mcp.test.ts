import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthorityApprovalProfile } from "../src/authority-request-manager.js";
import type { AppConfig } from "../src/config.js";
import type {
  LocalAuthorityBroker,
  LocalAuthorityBrokerResult,
  LocalAuthorityOutcome,
} from "../src/local-authority-broker.js";
import { createRuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];

async function closeServer(server: ReturnType<typeof startHttp>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

class ControlledBroker implements LocalAuthorityBroker {
  readonly seen: Array<{ requestId: string; profile: AuthorityApprovalProfile }> = [];
  private readonly resolvers = new Map<string, (result: LocalAuthorityBrokerResult) => void>();

  async request(input: { requestId: string; profile: AuthorityApprovalProfile }): Promise<LocalAuthorityBrokerResult> {
    this.seen.push(input);
    return new Promise((resolve) => this.resolvers.set(input.requestId, resolve));
  }

  async complete(requestId: string, outcome: LocalAuthorityOutcome): Promise<void> {
    const input = this.seen.find((item) => item.requestId === requestId);
    const resolve = this.resolvers.get(requestId);
    if (!input || !resolve) throw new Error("unknown controlled request");
    resolve({
      requestId,
      profile: input.profile,
      approved: outcome === "authenticated",
      outcome,
    });
    this.resolvers.delete(requestId);
    await Promise.resolve();
    await Promise.resolve();
  }
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-approval-mcp-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);

  const token = "approval-integration-token-0123456789";
  const config: AppConfig = {
    roots: [root],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    http: { host: "127.0.0.1", port: 0, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 2_000,
    },
  };

  const broker = new ControlledBroker();
  const server = startHttp(createRuntimeServices(config, { approvalBroker: broker }));
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "authority-approval-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, broker, client, transport };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("local authority approval MCP flow", () => {
  it("discovers request/status tools and rejects direct user/admin start", async () => {
    const { root, client, transport } = await fixture();
    try {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      for (const name of ["session_authority_request", "session_authority_request_status"]) {
        expect(byName.get(name), `missing ${name}`).toBeDefined();
        expect(byName.get(name)?.outputSchema).toMatchObject({ type: "object" });
        expect(byName.get(name)?.annotations).toMatchObject({ openWorldHint: false });
      }

      const directUser = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "user" },
      });
      expect(directUser.isError).toBe(true);
      expect(textContent(directUser)).toContain("LOCAL_APPROVAL_REQUIRED");

      const directAdmin = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "admin" },
      });
      expect(directAdmin.isError).toBe(true);
      expect(textContent(directAdmin)).toContain("LOCAL_APPROVAL_REQUIRED");

      const project = await client.callTool({
        name: "session_authority_start",
        arguments: { profile: "project", projectRoots: [root], requestedTtlSeconds: 60 },
      });
      expect(project.isError).not.toBe(true);
      expect(project.structuredContent).toMatchObject({
        profile: "project",
        terminalEnabled: false,
        commands: [],
      });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("returns pending, then consumes one native-approved user request into one non-terminal lease", async () => {
    const { root, broker, client, transport } = await fixture();
    try {
      const requested = await client.callTool({
        name: "session_authority_request",
        arguments: { profile: "user", requestedTtlSeconds: 75 },
      });
      expect(requested.isError).not.toBe(true);
      expect(requested.structuredContent).toMatchObject({ profile: "user", state: "pending" });
      const requestId = (requested.structuredContent as { requestId: string }).requestId;
      expect(broker.seen).toContainEqual({ requestId, profile: "user" });

      const pending = await client.callTool({
        name: "session_authority_request_status",
        arguments: { requestId },
      });
      expect(pending.structuredContent).toMatchObject({ requestId, profile: "user", state: "pending" });
      expect(pending.structuredContent).not.toHaveProperty("lease");

      await broker.complete(requestId, "authenticated");
      const approved = await client.callTool({
        name: "session_authority_request_status",
        arguments: { requestId },
      });
      expect(approved.isError).not.toBe(true);
      expect(approved.structuredContent).toMatchObject({
        requestId,
        profile: "user",
        state: "consumed",
        lease: {
          leaseId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
          profile: "user",
          terminalEnabled: false,
          commands: [],
        },
      });

      const userLeaseId = (approved.structuredContent as { lease: { leaseId: string } }).lease.leaseId;
      const deniedTerminal = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: userLeaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(deniedTerminal.isError).toBe(true);
      expect(textContent(deniedTerminal)).toContain("POLICY_DENIED");

      const secondStatus = await client.callTool({
        name: "session_authority_request_status",
        arguments: { requestId },
      });
      expect(secondStatus.isError).not.toBe(true);
      expect(secondStatus.structuredContent).toMatchObject({ requestId, state: "consumed" });
      expect(secondStatus.structuredContent).not.toHaveProperty("lease");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("mints a terminal-capable admin lease only after native approval", async () => {
    const { root, broker, client, transport } = await fixture();
    try {
      const requested = await client.callTool({
        name: "session_authority_request",
        arguments: { profile: "admin", requestedTtlSeconds: 60 },
      });
      const requestId = (requested.structuredContent as { requestId: string }).requestId;
      await broker.complete(requestId, "authenticated");

      const approved = await client.callTool({
        name: "session_authority_request_status",
        arguments: { requestId },
      });
      expect(approved.isError).not.toBe(true);
      expect(approved.structuredContent).toMatchObject({
        requestId,
        profile: "admin",
        state: "consumed",
        lease: {
          leaseId: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
          profile: "admin",
          terminalEnabled: true,
          commands: expect.arrayContaining(["node", "git"]),
        },
      });

      const adminLeaseId = (approved.structuredContent as { lease: { leaseId: string } }).lease.leaseId;
      const nodeVersion = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: adminLeaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(nodeVersion.isError).not.toBe(true);
      expect(nodeVersion.structuredContent).toMatchObject({ exitCode: 0, timedOut: false });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it.each(["denied", "cancelled", "failed"] as const)("never mints a lease after %s", async (outcome) => {
    const { broker, client, transport } = await fixture();
    try {
      const requested = await client.callTool({
        name: "session_authority_request",
        arguments: { profile: "admin" },
      });
      const requestId = (requested.structuredContent as { requestId: string }).requestId;
      await broker.complete(requestId, outcome);

      const status = await client.callTool({
        name: "session_authority_request_status",
        arguments: { requestId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({ requestId, profile: "admin", state: outcome });
      expect(status.structuredContent).not.toHaveProperty("lease");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
