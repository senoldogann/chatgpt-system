import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { createRuntimeServices, type RuntimeServices } from "../src/server.js";
import { startHttp } from "../src/transport.js";

const cleanups: string[] = [];
const servers: ReturnType<typeof startHttp>[] = [];
const runtimes: RuntimeServices[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.processSupervisor.close();
    await runtime.browser.close();
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "chatgpt-system-fs-edit-mcp-")));
  cleanups.push(root);
  const token = "fs-edit-mcp-token-0123456789";
  const config = await loadConfig({
    roots: [root],
    auditFile: path.join(root, ".audit", "audit.jsonl"),
    continuityDatabasePath: path.join(root, ".audit", "continuity.db"),
    host: "127.0.0.1",
    port: 0,
    token,
  });
  const runtime = createRuntimeServices(config);
  runtimes.push(runtime);
  const server = startHttp(runtime);
  servers.push(server);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const client = new Client({ name: "fs-edit-mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { root, client, transport };
}

describe("IDE editing MCP tools", () => {
  it("reads a line range and applies an exact edit guarded by the whole-file hash", async () => {
    const { root, client, transport } = await fixture();
    try {
      await writeFile(path.join(root, "app.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n", "utf8");

      const read = await client.callTool({ name: "fs_read", arguments: { path: "app.ts", offset: 2, limit: 1 } });
      expect(read.isError).not.toBe(true);
      const readBody = read.structuredContent as { content: string; sha256: string; range: { totalLines: number } };
      expect(readBody.content).toBe("export const b = 2;");
      expect(readBody.range.totalLines).toBe(3);

      const edited = await client.callTool({
        name: "fs_edit",
        arguments: { path: "app.ts", oldString: "b = 2", newString: "b = 20", expectedSha256: readBody.sha256 },
      });
      expect(edited.isError, JSON.stringify(edited.content)).not.toBe(true);
      expect(edited.structuredContent).toMatchObject({ replacements: 1, previousSha256: readBody.sha256 });
      expect(await readFile(path.join(root, "app.ts"), "utf8")).toBe("export const a = 1;\nexport const b = 20;\nexport const c = 3;\n");

      const ambiguous = await client.callTool({
        name: "fs_edit",
        arguments: { path: "app.ts", oldString: "export const", newString: "const" },
      });
      expect(ambiguous.isError).toBe(true);
      expect(JSON.stringify(ambiguous.content)).toContain("more than one location");

      const many = await client.callTool({
        name: "fs_read_many",
        arguments: { files: [{ path: "app.ts", offset: 1, limit: 1 }, { path: "nope.ts" }] },
      });
      expect(many.isError, JSON.stringify(many.content)).not.toBe(true);
      expect((many.structuredContent as { files: unknown[] }).files).toEqual([
        expect.objectContaining({ path: "app.ts", content: "export const a = 1;" }),
        { path: "nope.ts", error: "NOT_FOUND", message: "File does not exist." },
      ]);

      const { tools } = await client.listTools();
      const tool = tools.find((item) => item.name === "fs_edit");
      expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(tool?.inputSchema).toMatchObject({ additionalProperties: false, required: ["path", "oldString", "newString"] });
    } finally {
      await transport.terminateSession();
      await client.close();
    }
  });
});
