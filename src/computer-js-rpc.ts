import { z } from "zod";
import type { ComputerJsRpcMethod } from "./computer-js-protocol.js";
import { ComputerError } from "./computer-errors.js";
import type { ComputerProgramSession } from "./computer-runtime.js";
import type { ComputerAction, ComputerTarget } from "./computer-types.js";

const emptySchema = z.object({}).strict();
const selectorFields = {
  bundleIdentifier: z.string().min(1).max(4_096).optional(),
  name: z.string().min(1).max(4_096).optional(),
};
const pointFields = { x: z.number().finite(), y: z.number().finite() };
const targetTextSchema = z.string().min(1).max(4_096);
const retryBudgetSchema = z.number().int().min(0).max(2);
const computerTargetSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("index"), snapshotId: targetTextSchema, index: z.number().int().nonnegative() }).strict(),
  z.object({
    by: z.literal("role"),
    role: targetTextSchema,
    name: targetTextSchema.optional(),
    exact: z.boolean().optional(),
  }).strict(),
  z.object({ by: z.literal("text"), text: targetTextSchema, exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("label"), label: targetTextSchema, exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("ocrText"), text: targetTextSchema, exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("point"), ...pointFields }).strict(),
]);
type ParsedComputerTarget = z.infer<typeof computerTargetSchema>;
const coordinateSchema = z.object(pointFields).strict();
const actionLocationFields = { target: computerTargetSchema, retryBudget: retryBudgetSchema.optional() };
const motionModeSchema = z.enum(["instant", "fast", "natural"]);
const mouseButtonSchema = z.enum(["left", "right", "middle"]);
const modifierSchema = z.enum(["control", "option", "shift", "command"]);
const modifiersSchema = z.array(modifierSchema).max(4).refine((values) => new Set(values).size === values.length);
const verificationTimeoutSchema = z.number().int().min(50).max(10_000);
const focusTimeoutSchema = z.number().int().min(50).max(5_000);

const verificationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ax_changed"), timeoutMs: verificationTimeoutSchema.optional() }).strict(),
  z.object({
    kind: z.literal("text_appeared"),
    text: z.string().min(1).max(4_096),
    exact: z.boolean().optional(),
    timeoutMs: verificationTimeoutSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("screen_region_changed"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
    timeoutMs: verificationTimeoutSchema.optional(),
  }).strict(),
]);

const openSchema = z.object({ ...selectorFields, timeoutMs: focusTimeoutSchema.optional() }).strict();
const focusSchema = z.object({ ...selectorFields, timeoutMs: focusTimeoutSchema.optional() }).strict();
const moveSchema = z.union([
  z.object({ ...pointFields, motionMode: motionModeSchema.optional(), verify: verificationSchema.optional() }).strict(),
  z.object({ ...actionLocationFields, motionMode: motionModeSchema.optional(), verify: verificationSchema.optional() }).strict(),
]);
const clickSchema = z.union([
  z.object({
    ...pointFields,
    button: mouseButtonSchema.optional(),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
  z.object({
    ...actionLocationFields,
    button: mouseButtonSchema.optional(),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
]);
const dragSchema = z.object({
  from: z.union([coordinateSchema, computerTargetSchema]),
  to: z.union([coordinateSchema, computerTargetSchema]),
  retryBudget: retryBudgetSchema.optional(),
  button: mouseButtonSchema.optional(),
  motionMode: motionModeSchema.optional(),
  verify: verificationSchema.optional(),
}).strict();
const scrollFields = {
  vertical: z.number().int().min(-10_000).max(10_000),
  horizontal: z.number().int().min(-10_000).max(10_000),
  motionMode: motionModeSchema.optional(),
  verify: verificationSchema.optional(),
};
const scrollSchema = z.union([
  z.object(scrollFields).strict(),
  z.object({ ...scrollFields, ...pointFields }).strict(),
  z.object({ ...scrollFields, ...actionLocationFields }).strict(),
]);
const typeTextSchema = z.object({
  text: z.string().max(16_384),
  ...selectorFields,
  verify: verificationSchema.optional(),
}).strict();
const pressKeySchema = z.object({
  key: z.string().min(1).max(128),
  modifiers: modifiersSchema.optional(),
  ...selectorFields,
  verify: verificationSchema.optional(),
}).strict();
const waitSchema = z.object({ durationMs: z.number().int().nonnegative() }).strict();
const waitForFrontmostSchema = z.object({ ...selectorFields, timeoutMs: verificationTimeoutSchema.optional() }).strict();
const waitForTextSchema = z.object({
  text: z.string().min(1).max(4_096),
  exact: z.boolean().optional(),
  timeoutMs: verificationTimeoutSchema.optional(),
}).strict();
const waitUntilChangedSchema = z.object({
  baselineDigest: z.string().min(1).max(4_096),
  timeoutMs: verificationTimeoutSchema.optional(),
}).strict();
const targetRequestSchema = z.object({
  target: computerTargetSchema,
  retryBudget: retryBudgetSchema.optional(),
}).strict();
const targetsRequestSchema = z.object({
  targets: z.array(computerTargetSchema).min(1).max(100),
  retryBudget: retryBudgetSchema.optional(),
}).strict();

function retryOptions(retryBudget: number | undefined): { retryBudget?: number } {
  return retryBudget === undefined ? {} : { retryBudget };
}

function canonicalTarget(target: ParsedComputerTarget): ComputerTarget {
  switch (target.by) {
    case "index":
      return { by: "index", snapshotId: target.snapshotId, index: target.index };
    case "role":
      return {
        by: "role",
        role: target.role,
        ...(target.name === undefined ? {} : { name: target.name }),
        ...(target.exact === undefined ? {} : { exact: target.exact }),
      };
    case "text":
    case "ocrText":
      return {
        by: target.by,
        text: target.text,
        ...(target.exact === undefined ? {} : { exact: target.exact }),
      };
    case "label":
      return {
        by: "label",
        label: target.label,
        ...(target.exact === undefined ? {} : { exact: target.exact }),
      };
    case "point":
      return { by: "point", x: target.x, y: target.y };
  }
}

function parse<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ComputerError("COMPUTER_PROTOCOL_INVALID");
  return parsed.data;
}

export async function dispatchComputerJsRpc(
  session: ComputerProgramSession,
  method: ComputerJsRpcMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "observe":
      parse(emptySchema, params);
      return session.execute({ type: "observe" });
    case "screenshot":
      parse(emptySchema, params);
      return session.screenshot();
    case "resolve": {
      const input = parse(targetRequestSchema, params);
      return session.resolve(canonicalTarget(input.target), retryOptions(input.retryBudget));
    }
    case "resolve_many": {
      const input = parse(targetsRequestSchema, params);
      return session.resolveMany(input.targets.map(canonicalTarget), retryOptions(input.retryBudget));
    }
    case "exists": {
      const input = parse(targetRequestSchema, params);
      return session.exists(canonicalTarget(input.target), retryOptions(input.retryBudget));
    }
    case "refresh_observation":
      parse(emptySchema, params);
      return session.refreshObservation();
    case "pointer_position":
      parse(emptySchema, params);
      return session.execute({ type: "pointer_position" });
    case "list_apps":
      parse(emptySchema, params);
      return session.listApps();
    case "active_window":
      parse(emptySchema, params);
      return session.activeWindow();
    case "open_app":
      return session.execute({ type: "open_app", ...parse(openSchema, params) } as ComputerAction);
    case "focus_app":
      return session.execute({ type: "focus_app", ...parse(focusSchema, params) } as ComputerAction);
    case "move_mouse":
      return session.execute({ type: "move_mouse", ...parse(moveSchema, params) } as ComputerAction);
    case "click":
      return session.execute({ type: "click", ...parse(clickSchema, params) } as ComputerAction);
    case "drag":
      return session.execute({ type: "drag", ...parse(dragSchema, params) } as ComputerAction);
    case "scroll":
      return session.execute({ type: "scroll", ...parse(scrollSchema, params) } as ComputerAction);
    case "type_text":
      return session.execute({ type: "type_text", ...parse(typeTextSchema, params) } as ComputerAction);
    case "press_key":
      return session.execute({ type: "press_key", ...parse(pressKeySchema, params) } as ComputerAction);
    case "wait":
      return session.execute({ type: "wait", ...parse(waitSchema, params) } as ComputerAction);
    case "wait_for_frontmost":
      return session.execute({ type: "wait_for_frontmost", ...parse(waitForFrontmostSchema, params) } as ComputerAction);
    case "wait_for_text":
      return session.execute({ type: "wait_for_text", ...parse(waitForTextSchema, params) } as ComputerAction);
    case "wait_until_changed":
      return session.execute({ type: "wait_until_changed", ...parse(waitUntilChangedSchema, params) } as ComputerAction);
    case "release_inputs":
      parse(emptySchema, params);
      return session.execute({ type: "release_inputs" });
  }
}
