import { createConnection, type Socket } from "node:net";
import {
  CONTROL_MAX_FRAME_BYTES,
  encodeControlFrame,
  parseControlResponse,
  type ControlRequest,
  type ControlResponse,
} from "./control-protocol.js";
import {
  ControlProtocolInvalidError,
  ControlSocketUnavailableError,
} from "./errors.js";

export interface ControlClientOptions {
  socketPath: string;
  timeoutMs?: number;
}

function unavailable(): ControlSocketUnavailableError {
  return new ControlSocketUnavailableError();
}

export async function requestControl(
  request: ControlRequest,
  options: ControlClientOptions,
): Promise<ControlResponse> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const frame = encodeControlFrame(request);

  return new Promise<ControlResponse>((resolve, reject) => {
    const socket: Socket = createConnection(options.socketPath);
    let settled = false;
    let buffer = Buffer.alloc(0);

    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const finishSuccess = (response: ControlResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write(frame);
    });

    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      if (buffer.byteLength > CONTROL_MAX_FRAME_BYTES) {
        finishError(new ControlProtocolInvalidError());
        return;
      }

      const newline = buffer.indexOf(0x0a);
      if (newline === -1) return;
      if (newline !== buffer.byteLength - 1) {
        finishError(new ControlProtocolInvalidError());
        return;
      }

      try {
        finishSuccess(parseControlResponse(buffer.subarray(0, newline).toString("utf8")));
      } catch (error) {
        finishError(error instanceof ControlProtocolInvalidError
          ? error
          : new ControlProtocolInvalidError());
      }
    });

    socket.once("timeout", () => finishError(unavailable()));
    socket.once("error", () => finishError(unavailable()));
    socket.once("close", () => {
      if (!settled) finishError(new ControlProtocolInvalidError());
    });
  });
}
