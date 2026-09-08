import { z } from "zod";
import { ControlProtocolInvalidError } from "./errors.js";

export const CONTROL_PROTOCOL_VERSION = 1 as const;
export const CONTROL_MAX_FRAME_BYTES = 65_536;

const pingRequestSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  action: z.literal("ping"),
}).strict();

const authorizeRequestSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  action: z.literal("authorize"),
  profile: z.enum(["user", "admin"]),
  requestedTtlSeconds: z.number().int().positive().optional(),
}).strict();

const revokeRequestSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  action: z.literal("revoke"),
  authorityLeaseId: z.string().min(40),
}).strict();

const controlRequestSchema = z.union([
  pingRequestSchema,
  authorizeRequestSchema,
  revokeRequestSchema,
]);

const leaseSchema = z.object({
  leaseId: z.string().min(1),
  profile: z.enum(["user", "admin"]),
  roots: z.array(z.string()),
  terminalEnabled: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
}).strict();

const pongResponseSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  ok: z.literal(true),
  pong: z.literal(true),
}).strict();

const leaseResponseSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  ok: z.literal(true),
  lease: leaseSchema,
}).strict();

const revokeResponseSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  ok: z.literal(true),
  revoked: z.literal(true),
}).strict();

const errorResponseSchema = z.object({
  version: z.literal(CONTROL_PROTOCOL_VERSION),
  ok: z.literal(false),
  error: z.string().min(1),
  message: z.string().min(1),
}).strict();

const controlResponseSchema = z.union([
  pongResponseSchema,
  leaseResponseSchema,
  revokeResponseSchema,
  errorResponseSchema,
]);

export type ControlRequest = z.infer<typeof controlRequestSchema>;
export type PingControlRequest = z.infer<typeof pingRequestSchema>;
export type AuthorizeControlRequest = z.infer<typeof authorizeRequestSchema>;
export type RevokeControlRequest = z.infer<typeof revokeRequestSchema>;
export type ControlResponse = z.infer<typeof controlResponseSchema>;
export type ControlLease = z.infer<typeof leaseSchema>;

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new ControlProtocolInvalidError();
  }
}

export function parseControlRequest(line: string): ControlRequest {
  const parsed = controlRequestSchema.safeParse(parseJson(line));
  if (!parsed.success) throw new ControlProtocolInvalidError();
  return parsed.data;
}

export function parseControlResponse(line: string): ControlResponse {
  const parsed = controlResponseSchema.safeParse(parseJson(line));
  if (!parsed.success) throw new ControlProtocolInvalidError();
  return parsed.data;
}

export function encodeControlFrame(value: unknown): Buffer {
  let encoded: Buffer;
  try {
    encoded = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  } catch {
    throw new ControlProtocolInvalidError();
  }
  if (encoded.byteLength > CONTROL_MAX_FRAME_BYTES) {
    throw new ControlProtocolInvalidError("The local authority control protocol frame exceeds the size limit.");
  }
  return encoded;
}
