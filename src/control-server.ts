import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import {
  CONTROL_MAX_FRAME_BYTES,
  CONTROL_PROTOCOL_VERSION,
  encodeControlFrame,
  parseControlRequest,
} from "./control-protocol.js";
import {
  AppError,
  ControlProtocolInvalidError,
  ControlSocketInUseError,
} from "./errors.js";
import type { RuntimeServices } from "./server.js";

export interface ControlServerOptions {
  socketPath: string;
  runtime: RuntimeServices;
  currentUid?: number;
}

export interface ControlServerHandle {
  socketPath: string;
  close(): Promise<void>;
}

type ExistingSocketProbe = "live" | "stale" | "occupied";

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isClearlyStaleConnectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ECONNREFUSED" || error.code === "ENOENT";
}

function safeErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return {
      version: CONTROL_PROTOCOL_VERSION,
      ok: false as const,
      error: error.code,
      message: error.message,
    };
  }
  return {
    version: CONTROL_PROTOCOL_VERSION,
    ok: false as const,
    error: "CONTROL_PROTOCOL_INVALID",
    message: "The local authority control protocol message is invalid.",
  };
}

async function probeExistingSocket(socketPath: string): Promise<ExistingSocketProbe> {
  return new Promise<ExistingSocketProbe>((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];

    const finish = (result: ExistingSocketProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.write(encodeControlFrame({ version: CONTROL_PROTOCOL_VERSION, action: "ping" }));
    });
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > CONTROL_MAX_FRAME_BYTES) {
        finish("occupied");
        return;
      }
      chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      const newline = text.indexOf("\n");
      if (newline === -1) return;
      try {
        const parsed = JSON.parse(text.slice(0, newline)) as Record<string, unknown>;
        if (
          parsed.version === CONTROL_PROTOCOL_VERSION &&
          parsed.ok === true &&
          parsed.pong === true
        ) {
          finish("live");
        } else {
          finish("occupied");
        }
      } catch {
        finish("occupied");
      }
    });
    socket.once("timeout", () => finish("occupied"));
    socket.once("error", (error) => {
      finish(isClearlyStaleConnectError(error) ? "stale" : "occupied");
    });
    socket.once("close", () => {
      if (!settled) finish("occupied");
    });
  });
}

async function prepareSocketPath(socketPath: string, currentUid: number): Promise<void> {
  const parent = path.dirname(socketPath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await chmod(parent, 0o700);

  let info;
  try {
    info = await lstat(socketPath);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  if (!info.isSocket() || info.uid !== currentUid) {
    throw new ControlSocketInUseError();
  }

  const probe = await probeExistingSocket(socketPath);
  if (probe !== "stale") throw new ControlSocketInUseError();

  await unlink(socketPath);
}

function respond(socket: Socket, value: unknown): void {
  if (socket.destroyed) return;
  socket.end(encodeControlFrame(value));
}

function handleConnection(socket: Socket): void {
  let buffer = Buffer.alloc(0);
  let responded = false;

  const fail = (error: unknown) => {
    if (responded) return;
    responded = true;
    respond(socket, safeErrorResponse(error));
  };

  socket.on("data", (chunk: Buffer) => {
    if (responded) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.byteLength > CONTROL_MAX_FRAME_BYTES) {
      fail(new ControlProtocolInvalidError());
      return;
    }

    const newline = buffer.indexOf(0x0a);
    if (newline === -1) return;
    if (newline !== buffer.byteLength - 1) {
      fail(new ControlProtocolInvalidError());
      return;
    }

    let request;
    try {
      request = parseControlRequest(buffer.subarray(0, newline).toString("utf8"));
    } catch (error) {
      fail(error);
      return;
    }

    responded = true;
    if (request.action === "ping") {
      respond(socket, { version: CONTROL_PROTOCOL_VERSION, ok: true, pong: true });
      return;
    }

    respond(socket, safeErrorResponse(new ControlProtocolInvalidError(
      "Authorization is not available through the local control server yet.",
    )));
  });

  socket.on("end", () => {
    if (!responded && buffer.byteLength > 0) fail(new ControlProtocolInvalidError());
  });

  socket.on("error", () => {
    socket.destroy();
  });
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

async function cleanupOwnedSocket(socketPath: string, currentUid: number): Promise<void> {
  let info;
  try {
    info = await lstat(socketPath);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  if (info.isSocket() && info.uid === currentUid) {
    await unlink(socketPath);
  }
}

export async function startControlServer(options: ControlServerOptions): Promise<ControlServerHandle> {
  const currentUid = options.currentUid ?? process.getuid?.() ?? 0;
  await prepareSocketPath(options.socketPath, currentUid);

  const server = createServer(handleConnection);
  try {
    await listen(server, options.socketPath);
    await chmod(options.socketPath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }

  let closed = false;
  return {
    socketPath: options.socketPath,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await cleanupOwnedSocket(options.socketPath, currentUid);
    },
  };
}
