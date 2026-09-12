import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import { ComputerError } from "./computer-errors.js";
import type { ComputerAction } from "./computer-types.js";
import { AppError } from "./errors.js";
import { createScopedRuntime, type ScopedRuntimeBase } from "./scoped-runtime.js";
import { ScopedComputerService } from "./scoped-computer-service.js";
import {
  computerActionResultOutputSchema,
  computerApplicationResultOutputSchema,
  computerChangedDigestOutputSchema,
  computerHealthOutputSchema,
  computerObservationOutputSchema,
  computerPointResultOutputSchema,
  computerRunOutputSchema,
  computerScreenshotMetadataOutputSchema,
} from "./tool-output-schemas.js";

export interface ComputerToolRuntime extends ScopedRuntimeBase {
  authority: AuthorityManager;
}

const authorityLeaseField = { authorityLeaseId: z.string().min(40) };
const selectorFields = {
  bundleIdentifier: z.string().min(1).max(4_096).optional(),
  name: z.string().min(1).max(4_096).optional(),
};
const pointFields = { x: z.number(), y: z.number() };
const retryBudgetSchema = z.number().int().min(0).max(2);
const computerTargetSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("index"), snapshotId: z.string().min(1).max(4_096), index: z.number().int().nonnegative() }).strict(),
  z.object({ by: z.literal("role"), role: z.string().min(1).max(4_096), name: z.string().min(1).max(4_096).optional(), exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("text"), text: z.string().min(1).max(4_096), exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("label"), label: z.string().min(1).max(4_096), exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("ocrText"), text: z.string().min(1).max(4_096), exact: z.boolean().optional() }).strict(),
  z.object({ by: z.literal("point"), x: z.number(), y: z.number() }).strict(),
]);
const targetLocationFields = { target: computerTargetSchema, retryBudget: retryBudgetSchema.optional() };
const endpointSchema = z.union([z.object(pointFields).strict(), computerTargetSchema]);
const motionModeSchema = z.enum(["instant", "fast", "natural"]);
const mouseButtonSchema = z.enum(["left", "right", "middle"]);
const modifierSchema = z.enum(["control", "option", "shift", "command"]);
const modifiersSchema = z.array(modifierSchema).max(4).refine((values) => new Set(values).size === values.length, {
  message: "Modifiers must be unique.",
});
const verificationTimeoutSchema = z.number().int().min(50).max(10_000);
const focusTimeoutSchema = z.number().int().min(50).max(5_000);

const verificationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ax_changed"),
    timeoutMs: verificationTimeoutSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("text_appeared"),
    text: z.string().min(1).max(4_096),
    exact: z.boolean().optional(),
    timeoutMs: verificationTimeoutSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("screen_region_changed"),
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    timeoutMs: verificationTimeoutSchema.optional(),
  }).strict(),
]);

const observeActionSchema = z.object({ type: z.literal("observe") }).strict();
const pointerActionSchema = z.object({ type: z.literal("pointer_position") }).strict();
const openActionSchema = z.object({
  type: z.literal("open_app"),
  ...selectorFields,
  timeoutMs: focusTimeoutSchema.optional(),
}).strict();
const focusActionSchema = z.object({
  type: z.literal("focus_app"),
  ...selectorFields,
  timeoutMs: focusTimeoutSchema.optional(),
}).strict();
const moveActionSchema = z.union([
  z.object({
    type: z.literal("move_mouse"),
    ...pointFields,
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("move_mouse"),
    ...targetLocationFields,
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
]);
const clickActionSchema = z.union([
  z.object({
    type: z.literal("click"),
    ...pointFields,
    button: mouseButtonSchema.optional(),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("click"),
    ...targetLocationFields,
    button: mouseButtonSchema.optional(),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
]);
const doubleClickActionSchema = z.union([
  z.object({
    type: z.literal("double_click"),
    ...pointFields,
    button: mouseButtonSchema.optional(),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("double_click"),
    ...targetLocationFields,
    button: mouseButtonSchema.optional(),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
]);
const mouseDownActionSchema = z.object({
  type: z.literal("mouse_down"),
  button: mouseButtonSchema.optional(),
  verify: verificationSchema.optional(),
}).strict();
const mouseUpActionSchema = z.object({
  type: z.literal("mouse_up"),
  button: mouseButtonSchema.optional(),
  verify: verificationSchema.optional(),
}).strict();
const dragCoordinateActionSchema = z.object({
  type: z.literal("drag"),
  from: z.object(pointFields).strict(),
  to: z.object(pointFields).strict(),
  button: mouseButtonSchema.optional(),
  motionMode: motionModeSchema.optional(),
  verify: verificationSchema.optional(),
}).strict();
const dragSemanticActionSchema = z.object({
  type: z.literal("drag"),
  from: endpointSchema,
  to: endpointSchema,
  retryBudget: retryBudgetSchema.optional(),
  button: mouseButtonSchema.optional(),
  motionMode: motionModeSchema.optional(),
  verify: verificationSchema.optional(),
}).strict().refine((value) => "by" in value.from || "by" in value.to, { message: "Semantic drag requires at least one semantic endpoint." });
const dragActionSchema = z.union([dragCoordinateActionSchema, dragSemanticActionSchema]);
const scrollActionSchema = z.union([
  z.object({
    type: z.literal("scroll"),
    vertical: z.number().int().min(-10_000).max(10_000),
    horizontal: z.number().int().min(-10_000).max(10_000),
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("scroll"),
    vertical: z.number().int().min(-10_000).max(10_000),
    horizontal: z.number().int().min(-10_000).max(10_000),
    ...pointFields,
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("scroll"),
    vertical: z.number().int().min(-10_000).max(10_000),
    horizontal: z.number().int().min(-10_000).max(10_000),
    ...targetLocationFields,
    motionMode: motionModeSchema.optional(),
    verify: verificationSchema.optional(),
  }).strict(),
]);
const typeTextActionSchema = z.object({
  type: z.literal("type_text"),
  text: z.string().max(16_384),
  ...selectorFields,
  verify: verificationSchema.optional(),
}).strict();
const pressKeyActionSchema = z.object({
  type: z.literal("press_key"),
  key: z.string().min(1).max(128),
  modifiers: modifiersSchema.optional(),
  ...selectorFields,
  verify: verificationSchema.optional(),
}).strict();
const waitActionSchema = z.object({
  type: z.literal("wait"),
  durationMs: z.number().int().nonnegative(),
}).strict();
const waitForFrontmostActionSchema = z.object({
  type: z.literal("wait_for_frontmost"),
  ...selectorFields,
  timeoutMs: verificationTimeoutSchema.optional(),
}).strict();
const waitForTextActionSchema = z.object({
  type: z.literal("wait_for_text"),
  text: z.string().min(1).max(4_096),
  exact: z.boolean().optional(),
  timeoutMs: verificationTimeoutSchema.optional(),
}).strict();
const waitUntilChangedActionSchema = z.object({
  type: z.literal("wait_until_changed"),
  baselineDigest: z.string().min(1).max(4_096),
  timeoutMs: verificationTimeoutSchema.optional(),
}).strict();
const releaseInputsActionSchema = z.object({ type: z.literal("release_inputs") }).strict();

const computerActionSchema = z.union([
  observeActionSchema,
  pointerActionSchema,
  openActionSchema,
  focusActionSchema,
  moveActionSchema,
  clickActionSchema,
  doubleClickActionSchema,
  mouseDownActionSchema,
  mouseUpActionSchema,
  dragActionSchema,
  scrollActionSchema,
  typeTextActionSchema,
  pressKeyActionSchema,
  waitActionSchema,
  waitForFrontmostActionSchema,
  waitForTextActionSchema,
  waitUntilChangedActionSchema,
  releaseInputsActionSchema,
]);

const computerReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const computerMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
const computerIdempotentMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function safeErrorDetails(error: ComputerError): Record<string, unknown> | undefined {
  const details = error.details;
  if (!details) return undefined;
  const safe: Record<string, unknown> = {};
  if (Number.isInteger(details.failedStepIndex)) safe.failedStepIndex = details.failedStepIndex;
  if (typeof details.failedActionType === "string" && details.failedActionType.length <= 64) {
    safe.failedActionType = details.failedActionType;
  }
  if (Number.isInteger(details.completedCount)) safe.completedCount = details.completedCount;
  if (Number.isInteger(details.actionCount)) safe.actionCount = details.actionCount;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function computerErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ComputerError) {
    const details = safeErrorDetails(error);
    return {
      error: error.code,
      message: error.message,
      ...(details ? { details } : {}),
    };
  }
  if (error instanceof AppError) {
    return { error: error.code, message: error.message };
  }
  return { error: "INTERNAL_ERROR", message: "Computer operation failed." };
}

function successResult<T extends object>(value: T) {
  return {
    ...textResult(value),
    structuredContent: value as Record<string, unknown>,
  };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(computerErrorPayload(error)), isError: true };
  }
}

function computerFor(runtime: ComputerToolRuntime, authorityLeaseId: string) {
  const authority = runtime.authority.resolve(authorityLeaseId);
  return createScopedRuntime(runtime, authority).computer;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function registerComputerTools(server: McpServer, runtime: ComputerToolRuntime): void {
  const healthService = new ScopedComputerService(runtime.computer, runtime.audit, false);

  server.registerTool(
    "computer_health",
    {
      description: "Report categorical Computer Runtime readiness and passive macOS permission state without an authority lease.",
      inputSchema: z.object({}).strict(),
      outputSchema: computerHealthOutputSchema,
      annotations: computerReadAnnotations,
    },
    async () => safeCall(() => healthService.health()),
  );

  server.registerTool(
    "computer_observe",
    {
      description: "Return the bounded accessibility observation for the frontmost application. Requires Admin authority.",
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: computerObservationOutputSchema,
      annotations: computerReadAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(() => computerFor(runtime, authorityLeaseId).observe() as Promise<object>),
  );

  server.registerTool(
    "computer_screenshot",
    {
      description: "Capture a bounded main-display PNG as MCP image content. Screenshot bytes are not duplicated into structured JSON.",
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: computerScreenshotMetadataOutputSchema,
      annotations: computerReadAnnotations,
    },
    async ({ authorityLeaseId }) => {
      try {
        const screenshot = await computerFor(runtime, authorityLeaseId).screenshot();
        return {
          content: [{ type: "image" as const, data: screenshot.pngBase64, mimeType: "image/png" }],
          structuredContent: { width: screenshot.width, height: screenshot.height },
        };
      } catch (error) {
        return { ...textResult(computerErrorPayload(error)), isError: true };
      }
    },
  );

  server.registerTool(
    "computer_pointer_position",
    {
      description: "Read the current pointer position. Requires Admin authority.",
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: computerPointResultOutputSchema,
      annotations: computerReadAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(() => computerFor(runtime, authorityLeaseId).pointerPosition() as Promise<object>),
  );

  for (const [name, method] of [["computer_open_app", "openApp"], ["computer_focus_app", "focusApp"]] as const) {
    server.registerTool(
      name,
      {
        description: `${name === "computer_open_app" ? "Open or" : ""} focus one macOS application by bundle identifier or exact running name. Requires Admin authority.`,
        inputSchema: z.object({
          ...authorityLeaseField,
          ...selectorFields,
          timeoutMs: focusTimeoutSchema.optional(),
        }).strict(),
        outputSchema: computerApplicationResultOutputSchema,
        annotations: computerMutationAnnotations,
      },
      async ({ authorityLeaseId, bundleIdentifier, name: appName, timeoutMs }) => safeCall(() =>
        computerFor(runtime, authorityLeaseId)[method](compact({ bundleIdentifier, name: appName, timeoutMs }) as never) as Promise<object>),
    );
  }

  server.registerTool(
    "computer_move_mouse",
    {
      description: "Move the physical pointer to exact coordinates or a semantic target using deterministic motion. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        x: z.number().optional(),
        y: z.number().optional(),
        target: computerTargetSchema.optional(),
        retryBudget: retryBudgetSchema.optional(),
        motionMode: motionModeSchema.optional(),
        verify: verificationSchema.optional(),
      }).strict().superRefine((value, ctx) => {
        const hasX = value.x !== undefined;
        const hasY = value.y !== undefined;
        const hasTarget = value.target !== undefined;
        if (hasX !== hasY || hasTarget === hasX || (!hasTarget && value.retryBudget !== undefined)) {
          ctx.addIssue({ code: "custom", message: "Provide either x/y or target; retryBudget is semantic-only." });
        }
      }),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).moveMouse(compact(input) as never) as Promise<object>),
  );

  server.registerTool(
    "computer_click",
    {
      description: "Click or double-click exact coordinates or a semantic target. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        x: z.number().optional(),
        y: z.number().optional(),
        target: computerTargetSchema.optional(),
        retryBudget: retryBudgetSchema.optional(),
        count: z.union([z.literal(1), z.literal(2)]).default(1),
        button: mouseButtonSchema.optional(),
        motionMode: motionModeSchema.optional(),
        verify: verificationSchema.optional(),
      }).strict().superRefine((value, ctx) => {
        const hasX = value.x !== undefined;
        const hasY = value.y !== undefined;
        const hasTarget = value.target !== undefined;
        if (hasX !== hasY || hasTarget === hasX || (!hasTarget && value.retryBudget !== undefined)) {
          ctx.addIssue({ code: "custom", message: "Provide either x/y or target; retryBudget is semantic-only." });
        }
      }),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).click(compact(input) as never) as Promise<object>),
  );

  server.registerTool(
    "computer_drag",
    {
      description: "Drag between coordinate and/or semantic endpoints with deterministic motion. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        from: endpointSchema,
        to: endpointSchema,
        retryBudget: retryBudgetSchema.optional(),
        button: mouseButtonSchema.optional(),
        motionMode: motionModeSchema.optional(),
        verify: verificationSchema.optional(),
      }).strict().superRefine((value, ctx) => {
        const semantic = "by" in value.from || "by" in value.to;
        if (!semantic && value.retryBudget !== undefined) {
          ctx.addIssue({ code: "custom", message: "retryBudget is semantic-only." });
        }
      }),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).drag(compact(input) as never) as Promise<object>),
  );

  server.registerTool(
    "computer_scroll",
    {
      description: "Scroll vertically and/or horizontally, optionally at coordinates or a semantic target. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        vertical: z.number().int().min(-10_000).max(10_000),
        horizontal: z.number().int().min(-10_000).max(10_000),
        x: z.number().optional(),
        y: z.number().optional(),
        target: computerTargetSchema.optional(),
        retryBudget: retryBudgetSchema.optional(),
        motionMode: motionModeSchema.optional(),
        verify: verificationSchema.optional(),
      }).strict().superRefine((value, ctx) => {
        const hasX = value.x !== undefined;
        const hasY = value.y !== undefined;
        const hasTarget = value.target !== undefined;
        if (hasX !== hasY || (hasTarget && hasX) || (!hasTarget && value.retryBudget !== undefined)) {
          ctx.addIssue({ code: "custom", message: "Scroll position must be x/y, target, or omitted; retryBudget is semantic-only." });
        }
      }),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).scroll(compact(input) as never) as Promise<object>),
  );

  server.registerTool(
    "computer_type_text",
    {
      description: "Type bounded Unicode text into the expected frontmost application. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        text: z.string().max(16_384),
        ...selectorFields,
        verify: verificationSchema.optional(),
      }).strict(),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).typeText(input) as Promise<object>),
  );

  server.registerTool(
    "computer_press_key",
    {
      description: "Press a named key with optional modifiers in the expected frontmost application. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        key: z.string().min(1).max(128),
        modifiers: modifiersSchema.optional(),
        ...selectorFields,
        verify: verificationSchema.optional(),
      }).strict(),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).pressKey(input) as Promise<object>),
  );

  server.registerTool(
    "computer_release_inputs",
    {
      description: "Idempotently release runtime-held keyboard modifiers, keys, and mouse buttons. Requires Admin authority.",
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerIdempotentMutationAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(() => computerFor(runtime, authorityLeaseId).releaseInputs() as Promise<object>),
  );

  server.registerTool(
    "computer_wait_for_frontmost",
    {
      description: "Wait for the selected application to become frontmost. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        ...selectorFields,
        timeoutMs: verificationTimeoutSchema.optional(),
      }).strict(),
      outputSchema: computerApplicationResultOutputSchema,
      annotations: computerReadAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).waitForFrontmost(input) as Promise<object>),
  );

  server.registerTool(
    "computer_wait_for_text",
    {
      description: "Wait for bounded accessibility title/description text without reading editable values. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        text: z.string().min(1).max(4_096),
        exact: z.boolean().optional(),
        timeoutMs: verificationTimeoutSchema.optional(),
      }).strict(),
      outputSchema: computerActionResultOutputSchema,
      annotations: computerReadAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).waitForText(input) as Promise<object>),
  );

  server.registerTool(
    "computer_wait_until_changed",
    {
      description: "Wait until the accessibility digest differs from the supplied baseline. Requires Admin authority.",
      inputSchema: z.object({
        ...authorityLeaseField,
        baselineDigest: z.string().min(1).max(4_096),
        timeoutMs: verificationTimeoutSchema.optional(),
      }).strict(),
      outputSchema: computerChangedDigestOutputSchema,
      annotations: computerReadAnnotations,
    },
    async ({ authorityLeaseId, ...input }) => safeCall(() => computerFor(runtime, authorityLeaseId).waitUntilChanged(input) as Promise<object>),
  );

  server.registerTool(
    "computer_run",
    {
      description: "Execute a validated typed Computer Runtime action program under one physical-input lane. No automatic retry or UI rollback is implied.",
      inputSchema: z.object({
        ...authorityLeaseField,
        actions: z.array(computerActionSchema).min(1),
        finalObservation: z.enum(["none", "active_window", "observe"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
      }).strict(),
      outputSchema: computerRunOutputSchema,
      annotations: computerMutationAnnotations,
    },
    async ({ authorityLeaseId, actions, finalObservation, timeoutMs }) => safeCall(() =>
      computerFor(runtime, authorityLeaseId).run(compact({
        actions: actions as ComputerAction[],
        finalObservation,
        timeoutMs,
      })) as Promise<object>),
  );
}
