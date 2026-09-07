import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import {
  CONTROL_MAX_FRAME_BYTES,
  CONTROL_PROTOCOL_VERSION,
  encodeControlFrame,
  parseControlRequest,
  type AuthorizeControlRequest,
} from "./control-protocol.js";
import {
  AppError,
  AuthorizationBusyError,
  ControlProtocolInvalidError,
  ControlSocketInUseError,
  LocalApprovalDeniedError,
  LocalApprovalUnavailableError,
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

interface ControlServerState {
  authorizationInFlight: boolean;
}

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

function respond(socket: Socket, value: unknown): boolean {
  if (socket.destroyed) return false;
  socket.end(encodeControlFrame(value));
  return true;
}

function completionState(outcome: "authenticated" | "denied" | "cancelled" | "unavailable" | "failed") {
  if (outcome === "authenticated") return "approved" as const;
  if (outcome === "denied") return "denied" as const;
  if (outcome === "cancelled") return "cancelled" as const;
  return "failed" as const;
}

async function authorize(
  runtime: RuntimeServices,
  request: AuthorizeControlRequest,
  socket: Socket,
  state: ControlServerState,
) {
  if (state.authorizationInFlight) throw new AuthorizationBusyError();
  state.authorizationInFlight = true;

  try {
    const pending = runtime.authorityRequests.create({
      profile: request.profile,
      ...(request.requestedTtlSeconds !== undefined
        ? { requestedTtlSeconds: request.requestedTtlSeconds }
        : {}),
    });
    await runtime.authorityRequests.flushAudit();

    let native;
    try {
      native = await runtime.approvalBroker.request({
        requestId: pending.requestId,
        profile: pending.profile,
      });
    } catch (error) {
      try {
        runtime.authorityRequests.complete(pending.requestId, "failed");
        await runtime.authorityRequests.flushAudit();
      } catch {
        // The request may already have expired. Either way no lease can be minted.
      }
      if (error instanceof AppError) throw error;
      throw new LocalApprovalUnavailableError();
    }

    const completedState = completionState(native.outcome);
    runtime.authorityRequests.complete(pending.requestId, completedState);
    await runtime.authorityRequests.flushAudit();

    if (completedState !== "approved") {
      if (completedState === "denied" || completedState === "cancelled") {
        throw new LocalApprovalDeniedError();
      }
      throw new LocalApprovalUnavailableError();
    }

    const consumed = runtime.authorityRequests.consumeApproved(pending.requestId);
    await runtime.authorityRequests.flushAudit();
    const lease = await runtime.authority.start({
      profile: consumed.profile,
      ...(consumed.requestedTtlSeconds !== undefined
        ? { requestedTtlSeconds: consumed.requestedTtlSeconds }
        : {}),
    });
    await runtime.authority.flushAudit();

    if (socket.destroyed || socket.readableEnded) {
      runtime.authority.end(lease.leaseId);
      await runtime.authority.flushAudit();
      return undefined;
    }

    return {
      version: CONTROL_PROTOCOL_VERSION,
      ok: true as const,
      lease: {
        leaseId: lease.leaseId,
        profile: lease.profile,
        roots: lease.roots,
        terminalEnabled: lease.terminalEnabled,
        createdAt: lease.createdAt,
        expiresAt: lease.expiresAt,
      },
    };
  } finally {
    state.authorizationInFlight = false;
  }
}

function handleConnection(
  socket: Socket,
  runtime: RuntimeServices,
  state: ControlServerState,
): void {
  let buffer = Buffer.alloc(0);
  let handled = false;
  let responseSent = false;

  const sendOnce = (value: unknown) => {
    if (responseSent) return false;
    responseSent = true;
    return respond(socket, value);
  };

  const fail = (error: unknown) => {
    sendOnce(safeErrorResponse(error));
  };

  socket.on("data", (chunk: Buffer) => {
    if (handled) return;
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    if (buffer.byteLength > CONTROL_MAX_FRAME_BYTES) {
      handled = true;
      fail(new ControlProtocolInvalidError());
      return;
    }

    const newline = buffer.indexOf(0x0a);
    if (newline === -1) return;
    if (newline !== buffer.byteLength - 1) {
      handled = true;
      fail(new ControlProtocolInvalidError());
      return;
    }

    let request;
    try {
      request = parseControlRequest(buffer.subarray(0, newline).toString("utf8"));
    } catch (error) {
      handled = true;
      fail(error);
      return;
    }

    handled = true;
    if (request.action === "ping") {
      sendOnce({ version: CONTROL_PROTOCOL_VERSION, ok: true, pong: true });
      return;
    }

    void authorize(runtime, request, socket, state)
      .then((response) => {
        if (response !== undefined) sendOnce(response);
      })
      .catch(fail);
  });

  socket.on("end", () => {
    if (!handled && buffer.byteLength > 0) {
      handled = true;
      fail(new ControlProtocolInvalidError());
    }
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

  const state: ControlServerState = { authorizationInFlight: false };
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    handleConnection(socket, options.runtime, state);
  });

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
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await cleanupOwnedSocket(options.socketPath, currentUid);
    },
  };
}
