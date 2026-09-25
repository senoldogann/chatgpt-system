import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { createMcpServer, createRuntimeServices, type RuntimeServices } from "../src/server.js";

// Tüm yetenek kapıları açıkken yayınlanan kataloğun sözleşmesi: annotation
// tutarlılığı, açıklamalarda model yönlendirmesi olmaması ve açıklamaların
// gözden geçirilebilir anlık görüntüsü (araç tanımı değişikliği PR'da görünür).

interface CatalogTool {
  name: string;
  description?: string;
  annotations?: Record<string, unknown>;
}

let base: string;
let runtime: RuntimeServices;
let tools: CatalogTool[];

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-catalog-contract-"));
  const config = await loadConfig({
    roots: [base],
    auditFile: path.join(base, "audit.jsonl"),
    continuityDatabasePath: path.join(base, "continuity.db"),
    terminalEnabled: true,
    projectExecEnabled: true,
    ownerRuntimeEnabled: true,
    ownerShellPath: "/bin/sh",
    computerUseEnabled: true,
    fullHostJsEnabled: true,
    browserEnabled: true,
    browserHeadless: true,
  });
  runtime = createRuntimeServices(config);
  const server = createMcpServer(runtime);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "catalog-contract", version: "1.0.0" });
  await client.connect(clientTransport);
  tools = (await client.listTools()).tools;
  await client.close();
});

afterAll(async () => {
  await runtime.processSupervisor.close();
  await runtime.browser.close();
  await rm(base, { recursive: true, force: true });
});

describe("published tool catalog contract", () => {
  it("declares every annotation hint explicitly and consistently", () => {
    expect(tools.length).toBeGreaterThan(90);
    for (const tool of tools) {
      const hints = tool.annotations ?? {};
      for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(typeof hints[key], `${tool.name}.${key}`).toBe("boolean");
      }
      if (hints.readOnlyHint === true) expect(hints.destructiveHint, `${tool.name} is read-only`).toBe(false);
    }
  });

  it("never marks mutating or deleting tools as read-only", () => {
    for (const tool of tools) {
      if (/_(remove|delete)$/.test(tool.name)) {
        expect(tool.annotations?.destructiveHint, tool.name).toBe(true);
      }
      if (/(^|_)(write|edit|move|remove|delete|stop|close|end|commit|push|start|register|checkpoint|import)(_|$)/.test(tool.name)) {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
      }
    }
  });

  it("keeps descriptions factual, bounded and free of model-steering text", () => {
    const steering = /\bdo not use\b|\buse [\w*]+ instead\b|highly recommended|if chatgpt reports|ignore (all|previous)/i;
    for (const tool of tools) {
      const description = tool.description ?? "";
      expect(description.length, tool.name).toBeGreaterThan(20);
      expect(description.length, tool.name).toBeLessThanOrEqual(800);
      expect(description, tool.name).not.toMatch(steering);
    }
  });

  it("matches the reviewed description snapshot", () => {
    const descriptions = Object.fromEntries(
      [...tools].sort((left, right) => left.name.localeCompare(right.name)).map((tool) => [tool.name, tool.description]),
    );
    expect(descriptions).toMatchSnapshot();
  });
});
