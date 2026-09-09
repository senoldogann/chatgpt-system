import { randomBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { ComputerError, isComputerErrorCode, normalizeComputerNativeError } from "./computer-errors.js";
import {
  COMPUTER_MAX_REQUEST_LINE_BYTES,
  COMPUTER_MAX_RESPONSE_BYTES,
  COMPUTER_PROTOCOL_VERSION,
  type ComputerNativeMethod,
} from "./computer-types.js";

const nativeSuccessSchema = z.object({
  protocolVersion: z.literal(COMPUTER_PROTOCOL_VERSION),
  requestId: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown(),
}).strict();

const nativeFailureSchema = z.object({
  protocolVersion: z.literal(COMPUTER_PROTOCOL_VERSION),
  requestId: z.string().min(1),
  ok: z.literal(false),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
}).strict();

const nativeResponseSchema = z.discriminatedUnion("ok", [nativeSuccessSchema, nativeFailureSchema]);

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: ComputerError) => void;
  timer: NodeJS.Timeout;
};

export interface ComputerNativeClientOptions {
  stdin: Writable;
  stdout: Readable;
  requestIdFactory?: () => string;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  onFatal?: (error: ComputerError) => void;
}

function defaultRequestId(): string {
  return randomBytes(32).toString("base64url");
}

export class ComputerNativeClient {
  private readonly stdin: Writable;
  private readonly stdout: Readable;
  private readonly requestIdFactory: () => string;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly onFatal: ((error: ComputerError) => void) | undefined;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly pending = new Map<string, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private closedError: ComputerError | undefined;

  constructor(options: ComputerNativeClientOptions) {
    this.stdin = options.stdin;
    this.stdout = options.stdout;
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestId;
    this.maxRequestBytes = options.maxRequestBytes ?? COMPUTER_MAX_REQUEST_LINE_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? COMPUTER_MAX_RESPONSE_BYTES;
    this.onFatal = options.onFatal;

    if (!Number.isInteger(this.maxRequestBytes) || this.maxRequestBytes <= 0) {
      throw new Error("Computer native request frame limit must be a positive integer.");
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes <= 0) {
      throw new Error("Computer native response frame limit must be a positive integer.");
    }

    this.stdout.on("data", this.handleData);
    this.stdout.on("error", this.handleStreamError);
    this.stdout.on("end", this.handleStreamEnd);
  }

  request(
    method: ComputerNativeMethod,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
    }

    const requestId = this.requestIdFactory();
    if (!requestId || this.pending.has(requestId)) {
      const error = new ComputerError("COMPUTER_PROTOCOL_INVALID");
      this.poison(error);
      return Promise.reject(error);
    }

    let line: string;
    try {
      line = JSON.stringify({
        protocolVersion: COMPUTER_PROTOCOL_VERSION,
        requestId,
        method,
        params,
      });
    } catch {
      return Promise.reject(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
    }

    if (Buffer.byteLength(line, "utf8") > this.maxRequestBytes) {
      return Promise.reject(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.poison(new ComputerError("COMPUTER_TIMEOUT"));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.stdin.write(`${line}\n`, "utf8", (error?: Error | null) => {
          if (error) this.poison(new ComputerError("COMPUTER_UNAVAILABLE"));
        });
      } catch {
        this.poison(new ComputerError("COMPUTER_UNAVAILABLE"));
      }
    });
  }

  close(error = new ComputerError("COMPUTER_UNAVAILABLE")): void {
    this.finishClose(error, false);
  }

  get isClosed(): boolean {
    return this.closedError !== undefined;
  }

  private readonly handleData = (chunk: Buffer | string): void => {
    if (this.closedError) return;
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = Buffer.concat([this.buffer, next]);
    this.drainFrames();
  };

  private readonly handleStreamError = (): void => {
    if (!this.closedError) this.poison(new ComputerError("COMPUTER_UNAVAILABLE"));
  };

  private readonly handleStreamEnd = (): void => {
    if (!this.closedError) this.poison(new ComputerError("COMPUTER_UNAVAILABLE"));
  };

  private drainFrames(): void {
    while (!this.closedError) {
      const newlineIndex = this.buffer.indexOf(0x0a);
      if (newlineIndex === -1) {
        if (this.buffer.length > this.maxResponseBytes) {
          this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
        }
        return;
      }
      if (newlineIndex > this.maxResponseBytes) {
        this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
        return;
      }

      let frame = this.buffer.subarray(0, newlineIndex);
      this.buffer = this.buffer.subarray(newlineIndex + 1);
      if (frame.length > 0 && frame[frame.length - 1] === 0x0d) {
        frame = frame.subarray(0, frame.length - 1);
      }
      if (frame.length === 0) {
        this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
        return;
      }
      this.handleFrame(frame);
    }
  }

  private handleFrame(frame: Buffer): void {
    let parsedJson: unknown;
    try {
      const text = this.decoder.decode(frame);
      parsedJson = JSON.parse(text);
    } catch {
      this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
      return;
    }

    const parsed = nativeResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
      return;
    }

    const response = parsed.data;
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
      return;
    }

    if (!response.ok && !isComputerErrorCode(response.error.code)) {
      this.poison(new ComputerError("COMPUTER_PROTOCOL_INVALID"));
      return;
    }

    this.pending.delete(response.requestId);
    clearTimeout(pending.timer);
    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(normalizeComputerNativeError(response.error.code));
    }
  }

  private poison(error: ComputerError): void {
    this.finishClose(error, true);
  }

  private finishClose(error: ComputerError, notifyFatal: boolean): void {
    if (this.closedError) return;
    this.closedError = error;
    this.stdout.off("data", this.handleData);
    this.stdout.off("error", this.handleStreamError);
    this.stdout.off("end", this.handleStreamEnd);
    this.buffer = Buffer.alloc(0);

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    if (notifyFatal) this.onFatal?.(error);
  }
}
