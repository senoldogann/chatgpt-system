import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuthorityManager } from "./authority.js";
import { BROWSER_KEYS, BROWSER_ROLES } from "./browser-types.js";
import { errorPayload } from "./errors.js";
import { createOpenRuntime, createScopedRuntime, type ScopedRuntimeBase } from "./scoped-runtime.js";
import {
  browserActionOutputSchema,
  browserCloseOutputSchema,
  browserCloseTabOutputSchema,
  browserConsoleOutputSchema,
  browserHealthOutputSchema,
  browserNetworkOutputSchema,
  browserScreenshotMetadataOutputSchema,
  browserSnapshotOutputSchema,
  browserTabOutputSchema,
  browserTabsOutputSchema,
  browserWaitOutputSchema,
} from "./tool-output-schemas.js";

export interface BrowserToolRuntime extends ScopedRuntimeBase {
  authority: AuthorityManager;
}

const authorityLeaseField = { authorityLeaseId: z.string().min(40).optional() };
const pageIdField = { pageId: z.string().min(40).max(128) };
const browserTargetSchema = z.discriminatedUnion("by", [
  z.object({
    by: z.literal("role"),
    role: z.enum(BROWSER_ROLES),
    name: z.string().min(1).max(512).optional(),
    exact: z.boolean().optional(),
  }).strict(),
  z.object({
    by: z.literal("text"),
    text: z.string().min(1).max(4_096),
    exact: z.boolean().optional(),
  }).strict(),
  z.object({
    by: z.literal("label"),
    label: z.string().min(1).max(1_024),
    exact: z.boolean().optional(),
  }).strict(),
  z.object({
    by: z.literal("testId"),
    testId: z.string().min(1).max(1_024),
  }).strict(),
]);

const browserReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const browserMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
const browserIdempotentMutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
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
    return { ...textResult(errorPayload(error)), isError: true };
  }
}

function browserFor(runtime: BrowserToolRuntime, authorityLeaseId?: string) {
  if (authorityLeaseId !== undefined) {
    const authority = runtime.authority.resolve(authorityLeaseId);
    return createScopedRuntime(runtime, authority).browser;
  }
  return createOpenRuntime(runtime).browser;
}

const BROWSER_ROUTING_GUIDANCE = "Semantic Playwright Browser Runtime only. Do not use browser_* tools when the user explicitly asks for Computer Use, physical mouse/keyboard interaction, or real Google Chrome/macOS app control; use computer_* instead.";

function browserDescription(detail: string): string {
  return `${BROWSER_ROUTING_GUIDANCE} ${detail}`;
}

export function registerBrowserTools(server: McpServer, runtime: BrowserToolRuntime): void {
  server.registerTool(
    "browser_health",
    {
      description: browserDescription("Report categorical browser readiness without starting the browser or revealing browser content."),
      inputSchema: z.object({}).strict(),
      outputSchema: browserHealthOutputSchema,
      annotations: browserReadAnnotations,
    },
    async () => safeCall(() => runtime.browser.health()),
  );

  server.registerTool(
    "browser_tabs",
    {
      description: browserDescription("List browser tabs using opaque page IDs. No lease required."),
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: browserTabsOutputSchema,
      annotations: browserReadAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(() => browserFor(runtime, authorityLeaseId).tabs()),
  );

  server.registerTool(
    "browser_new_tab",
    {
      description: browserDescription("Create a browser tab and optionally navigate it to an HTTP(S) URL. No lease required."),
      inputSchema: z.object({
        ...authorityLeaseField,
        url: z.string().min(1).max(8_192).optional(),
      }).strict(),
      outputSchema: browserTabOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, url }) => safeCall(() => browserFor(runtime, authorityLeaseId).newTab(url)),
  );

  server.registerTool(
    "browser_select_tab",
    {
      description: browserDescription("Bring one opaque browser page to the front. No lease required."),
      inputSchema: z.object({ ...authorityLeaseField, ...pageIdField }).strict(),
      outputSchema: browserTabOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId }) => safeCall(() => browserFor(runtime, authorityLeaseId).selectTab(pageId)),
  );

  server.registerTool(
    "browser_close_tab",
    {
      description: browserDescription("Close one opaque browser page. No lease required."),
      inputSchema: z.object({ ...authorityLeaseField, ...pageIdField }).strict(),
      outputSchema: browserCloseTabOutputSchema,
      annotations: browserIdempotentMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId }) => safeCall(() => browserFor(runtime, authorityLeaseId).closeTab(pageId)),
  );

  server.registerTool(
    "browser_navigate",
    {
      description: browserDescription("Navigate one browser page to an HTTP(S) URL. Other URL schemes are refused before Playwright receives them."),
      inputSchema: z.object({
        ...authorityLeaseField,
        ...pageIdField,
        url: z.string().min(1).max(8_192),
      }).strict(),
      outputSchema: browserTabOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId, url }) => safeCall(() => browserFor(runtime, authorityLeaseId).navigate(pageId, url)),
  );

  server.registerTool(
    "browser_snapshot",
    {
      description: browserDescription("Return a bounded AI-oriented ARIA snapshot with current editable values removed. No lease required."),
      inputSchema: z.object({ ...authorityLeaseField, ...pageIdField }).strict(),
      outputSchema: browserSnapshotOutputSchema,
      annotations: browserReadAnnotations,
    },
    async ({ authorityLeaseId, pageId }) => safeCall(() => browserFor(runtime, authorityLeaseId).snapshot(pageId)),
  );

  server.registerTool(
    "browser_click",
    {
      description: browserDescription("Click exactly one semantic browser target. Raw selectors and JavaScript are not accepted."),
      inputSchema: z.object({
        ...authorityLeaseField,
        ...pageIdField,
        target: browserTargetSchema,
      }).strict(),
      outputSchema: browserActionOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId, target }) => safeCall(() => browserFor(runtime, authorityLeaseId).click(pageId, target)),
  );

  server.registerTool(
    "browser_fill",
    {
      description: browserDescription("Fill exactly one semantic target after credential-field refusal checks. Password, OTP, and payment credential fields are refused."),
      inputSchema: z.object({
        ...authorityLeaseField,
        ...pageIdField,
        target: browserTargetSchema,
        text: z.string().max(65_536),
      }).strict(),
      outputSchema: browserActionOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId, target, text }) => safeCall(() => browserFor(runtime, authorityLeaseId).fill(pageId, target, text)),
  );

  server.registerTool(
    "browser_select_option",
    {
      description: browserDescription("Select an option on exactly one semantic target. No lease required."),
      inputSchema: z.object({
        ...authorityLeaseField,
        ...pageIdField,
        target: browserTargetSchema,
        value: z.string().max(4_096),
      }).strict(),
      outputSchema: browserActionOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId, target, value }) => safeCall(() => browserFor(runtime, authorityLeaseId).selectOption(pageId, target, value)),
  );

  server.registerTool(
    "browser_press_key",
    {
      description: browserDescription("Press one key from the fixed browser key vocabulary after focused credential checks. No lease required."),
      inputSchema: z.object({
        ...authorityLeaseField,
        ...pageIdField,
        key: z.enum(BROWSER_KEYS),
      }).strict(),
      outputSchema: browserActionOutputSchema,
      annotations: browserMutationAnnotations,
    },
    async ({ authorityLeaseId, pageId, key }) => safeCall(() => browserFor(runtime, authorityLeaseId).pressKey(pageId, key)),
  );

  server.registerTool(
    "browser_wait_for_text",
    {
      description: browserDescription("Wait for visible text with the requested timeout capped by the configured browser timeout."),
      inputSchema: z.object({
        ...authorityLeaseField,
        ...pageIdField,
        text: z.string().min(1).max(4_096),
        timeoutMs: z.number().int().positive().max(600_000).optional(),
      }).strict(),
      outputSchema: browserWaitOutputSchema,
      annotations: browserReadAnnotations,
    },
    async ({ authorityLeaseId, pageId, text, timeoutMs }) => safeCall(() => browserFor(runtime, authorityLeaseId).waitForText(pageId, text, timeoutMs)),
  );

  server.registerTool(
    "browser_screenshot",
    {
      description: browserDescription("Capture one browser page as in-memory PNG content plus bounded dimensions. Screenshot bytes are never audited."),
      inputSchema: z.object({ ...authorityLeaseField, ...pageIdField }).strict(),
      outputSchema: browserScreenshotMetadataOutputSchema,
      annotations: browserReadAnnotations,
    },
    async ({ authorityLeaseId, pageId }) => {
      try {
        const screenshot = await browserFor(runtime, authorityLeaseId).screenshot(pageId);
        const structuredContent = {
          pageId: screenshot.pageId,
          width: screenshot.width,
          height: screenshot.height,
        };
        return {
          content: [{ type: "image" as const, data: screenshot.pngBase64, mimeType: "image/png" }],
          structuredContent,
        };
      } catch (error) {
        return { ...textResult(errorPayload(error)), isError: true };
      }
    },
  );

  server.registerTool(
    "browser_console_errors",
    {
      description: browserDescription("Read bounded recent console error/warning evidence with generation/sequence correlation and sanitized runtime source metadata when available. Source-map locations are never invented when deterministic mapping is unavailable. Console payload is never audited."),
      inputSchema: z.object({ ...authorityLeaseField, ...pageIdField }).strict(),
      outputSchema: browserConsoleOutputSchema,
      annotations: browserReadAnnotations,
    },
    async ({ authorityLeaseId, pageId }) => safeCall(() => browserFor(runtime, authorityLeaseId).consoleErrors(pageId)),
  );

  server.registerTool(
    "browser_network_errors",
    {
      description: browserDescription("Read bounded recent request/HTTP error evidence with generation/sequence, opaque request correlation, resource metadata, and sanitized initiator/URL fields. Query strings, fragments, headers, cookies, and bodies are not exposed."),
      inputSchema: z.object({ ...authorityLeaseField, ...pageIdField }).strict(),
      outputSchema: browserNetworkOutputSchema,
      annotations: browserReadAnnotations,
    },
    async ({ authorityLeaseId, pageId }) => safeCall(() => browserFor(runtime, authorityLeaseId).networkErrors(pageId)),
  );

  server.registerTool(
    "browser_close",
    {
      description: browserDescription("Idempotently close the owned browser context and clear in-memory browser state. A later action may lazily restart it."),
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: browserCloseOutputSchema,
      annotations: browserIdempotentMutationAnnotations,
    },
    async ({ authorityLeaseId }) => safeCall(() => browserFor(runtime, authorityLeaseId).close()),
  );
}
