import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ControlProtocolInvalidError,
  ControlSocketUnavailableError,
} from "../src/errors.js";
import { requestControl } from "../src/control-client.js";

const directories: string[] = [];
const servers: Server[] = [];

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

async function socketFixture(handler: (socket: Socket) => void) {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-client-"));
  directories.push(base);
  const socketPath = path.join(base, "control.sock");
  const server = createServer({ allowHalfOpen: true }, handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

function respondAfterRequest(socket: Socket, response: string): void {
  let input = "";
  socket.on("data", (chunk) => {
    input += chunk.toString("utf8");
    if (!input.includes("\n")) return;
    socket.end(response, "utf8");
  });
}

describe("local authority control client", () => {
  it("writes one request frame, keeps the connection open, and parses one response", async () => {
    let received = "";
    const socketPath = await socketFixture((socket) => {
      socket.on("data", (chunk) => {
        received += chunk.toString("utf8");
        if (received.includes("\n")) {
          socket.end('{"version":1,"ok":true,"pong":true}\n', "utf8");
        }
      });
    });

    const response = await requestControl(
      { version: 1, action: "ping" },
      { socketPath, timeoutMs: 1_000 },
    );

    expect(received).toBe('{"version":1,"action":"ping"}\n');
    expect(response).toEqual({ version: 1, ok: true, pong: true });
  });

  it("maps a missing socket and a response timeout to CONTROL_SOCKET_UNAVAILABLE", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-control-client-missing-"));
    directories.push(base);
    const missing = path.join(base, "missing.sock");

    await expect(requestControl(
      { version: 1, action: "ping" },
      { socketPath: missing, timeoutMs: 50 },
    )).rejects.toBeInstanceOf(ControlSocketUnavailableError);

    const hanging = await socketFixture(() => {
      // Intentionally accept without answering.
    });
    await expect(requestControl(
      { version: 1, action: "ping" },
      { socketPath: hanging, timeoutMs: 50 },
    )).rejects.toBeInstanceOf(ControlSocketUnavailableError);
  });

  it("rejects malformed and oversized responses as protocol failures", async () => {
    const malformed = await socketFixture((socket) => respondAfterRequest(socket, "not-json\n"));
    await expect(requestControl(
      { version: 1, action: "ping" },
      { socketPath: malformed, timeoutMs: 1_000 },
    )).rejects.toBeInstanceOf(ControlProtocolInvalidError);

    const oversized = await socketFixture((socket) => respondAfterRequest(socket, `${"x".repeat(70_000)}\n`));
    await expect(requestControl(
      { version: 1, action: "ping" },
      { socketPath: oversized, timeoutMs: 1_000 },
    )).rejects.toBeInstanceOf(ControlProtocolInvalidError);
  });

  it("returns a stable server error response without turning it into success", async () => {
    const socketPath = await socketFixture((socket) => respondAfterRequest(
      socket,
      '{"version":1,"ok":false,"error":"AUTHORIZATION_BUSY","message":"busy"}\n',
    ));

    await expect(requestControl(
      { version: 1, action: "authorize", profile: "admin" },
      { socketPath, timeoutMs: 1_000 },
    )).resolves.toEqual({
      version: 1,
      ok: false,
      error: "AUTHORIZATION_BUSY",
      message: "busy",
    });
  });
});
