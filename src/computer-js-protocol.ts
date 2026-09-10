import { z } from "zod";

export const COMPUTER_JS_RPC_METHODS = [
  "observe",
  "screenshot",
  "pointer_position",
  "list_apps",
  "active_window",
  "open_app",
  "focus_app",
  "move_mouse",
  "click",
  "drag",
  "scroll",
  "type_text",
  "press_key",
  "wait",
  "wait_for_frontmost",
  "wait_for_text",
  "wait_until_changed",
  "release_inputs",
] as const;

export const computerJsRpcMethodSchema = z.enum(COMPUTER_JS_RPC_METHODS);
export type ComputerJsRpcMethod = z.infer<typeof computerJsRpcMethodSchema>;

const rpcIdSchema = z.string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const runnerRpcMessageSchema = z.object({
  type: z.literal("rpc"),
  id: rpcIdSchema,
  method: computerJsRpcMethodSchema,
  params: z.unknown(),
}).strict();

export const runnerCompleteMessageSchema = z.object({
  type: z.literal("complete"),
  resultJson: z.string().optional(),
}).strict();

export const runnerWorkerExitMessageSchema = z.object({
  type: z.literal("worker_exit"),
  exitCode: z.number().int().min(0).max(255),
}).strict();

export const workerToRunnerMessageSchema = z.discriminatedUnion("type", [
  runnerRpcMessageSchema,
  runnerCompleteMessageSchema,
]);

export const runnerMessageSchema = z.discriminatedUnion("type", [
  runnerRpcMessageSchema,
  runnerCompleteMessageSchema,
  runnerWorkerExitMessageSchema,
]);

const runnerRpcErrorSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(4_096),
}).strict();

const runnerRpcSuccessResponseSchema = z.object({
  type: z.literal("rpc_result"),
  id: rpcIdSchema,
  ok: z.literal(true),
  result: z.unknown(),
}).strict();

const runnerRpcFailureResponseSchema = z.object({
  type: z.literal("rpc_result"),
  id: rpcIdSchema,
  ok: z.literal(false),
  error: runnerRpcErrorSchema,
}).strict();

export const runnerRpcResponseSchema = z.discriminatedUnion("ok", [
  runnerRpcSuccessResponseSchema,
  runnerRpcFailureResponseSchema,
]);

export type RunnerRpcMessage = z.infer<typeof runnerRpcMessageSchema>;
export type RunnerCompleteMessage = z.infer<typeof runnerCompleteMessageSchema>;
export type RunnerWorkerExitMessage = z.infer<typeof runnerWorkerExitMessageSchema>;
export type RunnerMessage = z.infer<typeof runnerMessageSchema>;
export type RunnerRpcResponse = z.infer<typeof runnerRpcResponseSchema>;
