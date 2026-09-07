import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
  type NodeServerResponseLike,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { RuntimeServices } from "./server.js";
import { createMcpServer } from "./server.js";

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return provided.byteLength === wanted.byteLength && timingSafeEqual(provided, wanted);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function startStdio(runtime: RuntimeServices) {
  return serveStdio(() => createMcpServer(runtime), {
    legacy: "serve",
    onerror: (error) => console.error("[chatgpt-system] MCP stdio error:", error),
  });
}

export function startHttp(runtime: RuntimeServices): HttpServer {
  const token = runtime.config.http.token;
  if (!token) {
    throw new Error("HTTP transport requires a bearer token. Set --token or CHATGPT_SYSTEM_HTTP_TOKEN (minimum 16 characters).");
  }

  const mcp = createMcpHandler(() => createMcpServer(runtime), {
    legacy: "stateless",
    onerror: (error) => console.error("[chatgpt-system] MCP HTTP protocol error:", error),
  });
  const nodeHandler = toNodeHandler(mcp, {
    onerror: (error) => console.error("[chatgpt-system] MCP HTTP adapter error:", error),
  });

  // Plain node:http does not apply the MCP SDK's localhost DNS-rebinding and
  // browser Origin protections for us. Match the SDK's framework defaults when
  // the listener is loopback-bound. A deliberately non-loopback deployment is
  // expected to sit behind its own authenticated TLS/reverse-proxy boundary.
  const validateHost = isLoopbackHost(runtime.config.http.host) ? localhostHostValidation() : undefined;
  const validateOrigin = isLoopbackHost(runtime.config.http.host) ? localhostOriginValidation() : undefined;

  const server = createHttpServer((req, res) => {
    if (validateHost && !validateHost(req, res)) return;
    if (validateOrigin && !validateOrigin(req, res)) return;

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, name: "chatgpt-system", version: "0.1.0" }));
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (!tokenMatches(req.headers.authorization, token)) {
      res.writeHead(401, {
        "content-type": "application/json; charset=utf-8",
        "www-authenticate": "Bearer",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // The adapter is explicitly designed for node:http. With
    // exactOptionalPropertyTypes enabled, Node's IncomingMessage declaration and
    // the SDK's minimal structural interface are not assignable even though the
    // runtime shapes are compatible. Keep that compatibility cast at this one
    // transport boundary rather than weakening strictness for the whole project.
    void nodeHandler(
      req as unknown as NodeIncomingMessageLike,
      res as unknown as NodeServerResponseLike,
    );
  });

  server.listen(runtime.config.http.port, runtime.config.http.host);
  return server;
}
