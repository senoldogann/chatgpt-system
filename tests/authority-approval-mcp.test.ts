import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { requestControl } from "../src/control-client.js";
import { CONTROL_PROTOCOL_VERSION } from "../src/control-protocol.js";
import { startControlServer, type ControlServerHandle } from "../src/control-server.js";
import type { AppConfig } from "../src/config.js";
import type {
  LocalAuthorityBroker,
  LocalAuthorityBrokerResult,
} from "../src/local-authority-broker.js";
import { createRuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const controls: ControlServerHandle[] = [];

async function closeServer(server: ReturnType<typeof startHttp>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

afterEach(async () => {
  await Promise.all(controls.splice(0).map((control) => control.close()));
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

class ApprovedBroker implements LocalAuthorityBroker {
  async request(input: { requestId: string; profile: "user" | "admin" }): Promise<LocalAuthorityBrokerResult> {
    return {
      requestId: input.requestId,
      profile: input.profile,
      approved: true,
      outcome: "authenticated",
    };
  }
}

async function fixture() {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-shared-authority-"));
  cleanups.push(base);
  const bootstrapRoot = path.join(base, "bootstrap");
  await mkdir(bootstrapRoot);

  const userFixture = await mkdtemp(path.join(homedir(), ".chatgpt-system-user-test-"));
  cleanups.push(userFixture);
  const userFile = path.join(userFixture, "hello.txt");
  await writeFile(userFile, "hello from local user lease\n", "utf8");

  const token = "shared-authority-token-0123456789";
  const socketPath = path.join(base, "control.sock");
  const config: AppConfig = {
    roots: [bootstrapRoot],
    auditFile: path.join(base, "audit.jsonl"),
    terminal: { enabled: false, commands: ["node", "git"] },
    control: { enabled: false, socketPath },
    http: { host: "127.0.0.1", port: 0, token },
    limits: {
      maxReadBytes: 1024 * 1024,
      maxWriteBytes: 1024 * 1024,
      maxDirectoryEntries: 100,
      maxCommandOutputBytes: 1024 * 1024,
      commandTimeoutMs: 2_000,
    },
  };

  const runtime = createRuntimeServices(config, { approvalBroker: new ApprovedBroker() });
  const control = await startControlServer({ socketPath, runtime });
  controls.push(control);

  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  const client = new Client({ name: "shared-authority-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);

  return { root: bootstrapRoot, userFile, socketPath, client, transport };
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return result.content
    .filter((item): item is Extract<typeof item, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function localLease(socketPath: string, profile: "user" | "admin") {
  const response = await requestControl({
    version: CONTROL_PROTOCOL_VERSION,
    action: "authorize",
    profile,
    requestedTtlSeconds: 60,
  }, { socketPath, timeoutMs: 2_000 });
  if (!response.ok || !("lease" in response)) throw new Error(`failed to mint ${profile} lease`);
  return response.lease;
}

describe("local authority leases consumed through MCP", () => {
  it("uses one locally approved User lease for MCP status/read while terminal stays denied", async () => {
    const { userFile, socketPath, client, transport } = await fixture();
    try {
      const lease = await localLease(socketPath, "user");
      expect(lease).toMatchObject({ profile: "user", terminalEnabled: false });

      const status = await client.callTool({
        name: "session_authority_status",
        arguments: { authorityLeaseId: lease.leaseId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({ profile: "user", terminalEnabled: false });

      const read = await client.callTool({
        name: "fs_read",
        arguments: { authorityLeaseId: lease.leaseId, path: userFile },
      });
      expect(read.isError).not.toBe(true);
      expect(read.structuredContent).toMatchObject({ content: "hello from local user lease\n" });

      const terminal = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: lease.leaseId, command: "node", args: ["--version"], cwd: homedir() },
      });
      expect(terminal.isError).toBe(true);
      expect(textContent(terminal)).toContain("POLICY_DENIED");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });

  it("uses one locally approved Admin lease for benign MCP terminal work and revokes it normally", async () => {
    const { root, socketPath, client, transport } = await fixture();
    try {
      const lease = await localLease(socketPath, "admin");
      expect(lease).toMatchObject({ profile: "admin", roots: ["/"], terminalEnabled: true });

      const status = await client.callTool({
        name: "session_authority_status",
        arguments: { authorityLeaseId: lease.leaseId },
      });
      expect(status.isError).not.toBe(true);
      expect(status.structuredContent).toMatchObject({ profile: "admin", terminalEnabled: true });

      const nodeVersion = await client.callTool({
        name: "terminal_run",
        arguments: { authorityLeaseId: lease.leaseId, command: "node", args: ["--version"], cwd: root },
      });
      expect(nodeVersion.isError).not.toBe(true);
      expect(nodeVersion.structuredContent).toMatchObject({ exitCode: 0, timedOut: false });

      const ended = await client.callTool({
        name: "session_authority_end",
        arguments: { authorityLeaseId: lease.leaseId },
      });
      expect(ended.isError).not.toBe(true);
      expect(ended.structuredContent).toMatchObject({ ended: true });

      const reuse = await client.callTool({
        name: "session_authority_status",
        arguments: { authorityLeaseId: lease.leaseId },
      });
      expect(reuse.isError).toBe(true);
      expect(textContent(reuse)).toContain("AUTHORITY_REQUIRED");
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
