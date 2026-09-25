import { timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
  type NodeIncomingMessageLike,
} from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  bridgeHello,
  prepareBridgeHandoff,
  readBridgeActivity,
  readBridgeContext,
  readBridgeStatusForAlias,
  resolveBridgeAlias,
} from "./bridge.js";
import { normalizeChatId } from "./chat-bindings.js";
import { ContinuityNotFoundError } from "./continuity-errors.js";
import { PolicyError } from "./errors.js";
import { isLoopbackHost } from "./config.js";
import type { RuntimeServices } from "./server.js";
import { createMcpServer } from "./server.js";

function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return provided.byteLength === wanted.byteLength && timingSafeEqual(provided, wanted);
}

export function startStdio(runtime: RuntimeServices) {
  return serveStdio(() => createMcpServer(runtime), {
    legacy: "serve",
    onerror: (error) => console.error("[chatgpt-system] MCP stdio error:", error),
  });
}

function bridgeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

// İstek yolu Host başlığından bağımsız çözülür: bozuk ya da düşmanca bir
// Host başlığı URL ayrıştırmasını etkileyemez ve isteği çökertemez.
function requestUrl(req: IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

// Sohbet bağı yalnızca gözlem ipucudur; yazılamazsa köprü isteği düşmez.
async function bindChatAlias(runtime: RuntimeServices, chatId: string, alias: string): Promise<void> {
  if (chatId === "" || alias === "") return;
  try {
    await runtime.chatBindings.bind(chatId, alias);
  } catch (error) {
    console.error(
      `[chatgpt-system] chat binding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// POST gövdesini 64KB tavanla okur; bozuk ya da büyük gövde null döner.
function readBridgeBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= 65_536) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > 65_536) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  runtime: RuntimeServices,
): Promise<void> {
  const alias = (url.searchParams.get("alias") ?? "").slice(0, 128);
  const chat = normalizeChatId(url.searchParams.get("chat") ?? "");
  try {
    if (req.method === "GET" && url.pathname === "/bridge/status") {
      bridgeJson(res, 200, await readBridgeStatusForAlias(runtime, alias, chat));
      return;
    }
    if (req.method === "GET" && url.pathname === "/bridge/context") {
      const resolved = await resolveBridgeAlias(runtime, alias, chat);
      if (resolved === "") {
        bridgeJson(res, 400, { error: "alias_required" });
        return;
      }
      // Panelden açık proje seçimi o sohbete sabitlenir; sonraki yoklamalar
      // alias göndermese de bağ korunur.
      if (alias.trim() !== "") await bindChatAlias(runtime, chat, resolved);
      bridgeJson(res, 200, await readBridgeContext(runtime, resolved));
      return;
    }
    if (req.method === "GET" && url.pathname === "/bridge/activity") {
      const resolved = await resolveBridgeAlias(runtime, alias, chat);
      if (resolved === "") {
        bridgeJson(res, 400, { error: "alias_required" });
        return;
      }
      const limit = Number(url.searchParams.get("limit") ?? "50");
      bridgeJson(res, 200, await readBridgeActivity(runtime, resolved, limit));
      return;
    }
    if (req.method === "POST" && url.pathname === "/bridge/handoff/prepare") {
      const body = await readBridgeBody(req);
      if (body === null || typeof body !== "object") {
        bridgeJson(res, 400, { error: "invalid_body" });
        return;
      }
      const record = body as { alias?: unknown; sessionId?: unknown; chat?: unknown };
      const bodyAlias = typeof record.alias === "string" ? record.alias : alias;
      const bodyChat = normalizeChatId(record.chat) || chat;
      const resolved = await resolveBridgeAlias(runtime, bodyAlias, bodyChat);
      if (resolved === "") {
        bridgeJson(res, 400, { error: "alias_required" });
        return;
      }
      const result = await prepareBridgeHandoff(
        runtime,
        resolved,
        typeof record.sessionId === "string" ? record.sessionId : undefined,
      );
      await bindChatAlias(runtime, bodyChat, resolved);
      bridgeJson(res, 200, result);
      return;
    }
    bridgeJson(res, 404, { error: "not_found" });
  } catch (error) {
    if (error instanceof ContinuityNotFoundError) {
      bridgeJson(res, 404, { error: "alias_not_found" });
      return;
    }
    if (error instanceof PolicyError) {
      bridgeJson(res, 422, { error: "handoff_unavailable", reason: error.message });
      return;
    }
    // Süreklilik DB'si MCP yazarı tarafından anlık kilitliyse 503 dönülür;
    // uzantı bir sonraki yoklamada yeniden dener.
    const code = (error as { code?: unknown }).code;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
      bridgeJson(res, 503, { error: "busy" });
      return;
    }
    throw error;
  }
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
    // Host kapısı ilk adımdır: başlık doğrulanmadan istek yolu çözülmez.
    // SDK doğrulayıcısı bozuk Host'u kendisi 403 ile kapatır.
    if (validateHost && !validateHost(req, res)) return;
    const url = requestUrl(req);
    if (url === null) {
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "invalid_url" }));
      return;
    }
    const isBridge = url.pathname === "/bridge/hello" || url.pathname.startsWith("/bridge/");
    // Tarayıcı uzantısı köprüsü tarayıcıdan chrome-extension:// kaynağıyla
    // gelir; MCP SDK'nın localhost Origin kapısı bunu reddeder. Köprü zaten
    // bearer token ister, bu yüzden Origin kapısı yalnızca /mcp için uygulanır.
    if (!isBridge && validateOrigin && !validateOrigin(req, res)) return;

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, name: "chatgpt-system", version: "0.1.0" }));
      return;
    }

    // Tarayıcı uzantısı köprüsü: hello kimlik yoklaması açıktır, veri
    // uçları MCP ile aynı bearer token ister. Content-script tokenı hiç
    // görmez; yalnızca service worker bu uçlara erişir.
    if (isBridge) {
      if (req.method === "GET" && url.pathname === "/bridge/hello") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify(bridgeHello()));
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
      void handleBridgeRequest(req, res, url, runtime).catch((error) => {
        console.error("[chatgpt-system] bridge error:", error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "bridge_failed" }));
        }
      });
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
      res,
    );
  });

  server.listen(runtime.config.http.port, runtime.config.http.host);
  return server;
}
