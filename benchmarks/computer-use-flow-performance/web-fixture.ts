import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { ComputerFlowScenarioId } from "./contract.js";

export interface ComputerFlowWebFixtureSession {
  scenarioId: Exclude<ComputerFlowScenarioId, "native-macos-fixture-workflow">;
  sessionId: string;
  url: string;
}

export type ComputerFlowWebOracle =
  | { scenarioId: "open-focus-verify"; pageReady: boolean }
  | {
      scenarioId: "batched-multi-control-form";
      textFieldsMatch: boolean;
      checkboxChecked: boolean;
      selectionMatch: boolean;
      submitted: boolean;
    }
  | {
      scenarioId: "scoped-nested-scrolling";
      innerTargetActivated: boolean;
      outerScrollChanged: boolean;
      unchangedScrollAttemptCount: number;
    }
  | {
      scenarioId: "stale-dynamic-target-recovery";
      rerendered: boolean;
      currentGenerationActivated: boolean;
    }
  | {
      scenarioId: "weak-ax-ocr-visual-point";
      visualTargetActivated: boolean;
      pointAttemptCount: number;
    };

export interface ComputerFlowWebSessionDiagnostics {
  documentRequestReceived: boolean;
  pageReadyEventReceived: boolean;
}

export interface ComputerFlowWebFixtureHandle {
  origin: string;
  createSession(scenarioId: ComputerFlowWebFixtureSession["scenarioId"]): Promise<ComputerFlowWebFixtureSession>;
  readOracle(sessionId: string): Promise<ComputerFlowWebOracle>;
  readSessionDiagnostics(sessionId: string): Promise<ComputerFlowWebSessionDiagnostics>;
  close(): Promise<void>;
}

interface SessionState {
  session: ComputerFlowWebFixtureSession;
  oracle: ComputerFlowWebOracle;
  documentRequestReceived: boolean;
}

const WEB_SCENARIOS = [
  "open-focus-verify",
  "batched-multi-control-form",
  "scoped-nested-scrolling",
  "stale-dynamic-target-recovery",
  "weak-ax-ocr-visual-point",
] as const satisfies readonly ComputerFlowWebFixtureSession["scenarioId"][];

const pageReadyEventSchema = z.object({ event: z.literal("page_ready") }).strict();
const formSubmittedEventSchema = z.object({
  event: z.literal("form_submitted"),
  textFieldsMatch: z.boolean(),
  checkboxChecked: z.boolean(),
  selectionMatch: z.boolean(),
}).strict();
const unchangedScrollEventSchema = z.object({ event: z.literal("unchanged_scroll_attempt") }).strict();
const innerTargetActivatedEventSchema = z.object({
  event: z.literal("inner_target_activated"),
  outerScrollChanged: z.boolean(),
}).strict();
const rerenderedEventSchema = z.object({ event: z.literal("rerendered") }).strict();
const currentGenerationActivatedEventSchema = z.object({ event: z.literal("current_generation_activated") }).strict();
const pointAttemptEventSchema = z.object({ event: z.literal("point_attempt") }).strict();
const visualTargetActivatedEventSchema = z.object({ event: z.literal("visual_target_activated") }).strict();

const MAX_BODY_BYTES = 16_384;
const MAX_COUNTER = 1_000;

function initialOracle(scenarioId: ComputerFlowWebFixtureSession["scenarioId"]): ComputerFlowWebOracle {
  switch (scenarioId) {
    case "open-focus-verify":
      return { scenarioId, pageReady: false };
    case "batched-multi-control-form":
      return {
        scenarioId,
        textFieldsMatch: false,
        checkboxChecked: false,
        selectionMatch: false,
        submitted: false,
      };
    case "scoped-nested-scrolling":
      return {
        scenarioId,
        innerTargetActivated: false,
        outerScrollChanged: false,
        unchangedScrollAttemptCount: 0,
      };
    case "stale-dynamic-target-recovery":
      return { scenarioId, rerendered: false, currentGenerationActivated: false };
    case "weak-ax-ocr-visual-point":
      return { scenarioId, visualTargetActivated: false, pointAttemptCount: 0 };
  }
}

async function readJsonBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error("Fixture event body exceeds limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function applyEvent(state: SessionState, json: string): void {
  const parsed = JSON.parse(json);
  switch (state.oracle.scenarioId) {
    case "open-focus-verify": {
      pageReadyEventSchema.parse(parsed);
      state.oracle = { scenarioId: state.oracle.scenarioId, pageReady: true };
      return;
    }
    case "batched-multi-control-form": {
      const event = formSubmittedEventSchema.parse(parsed);
      state.oracle = {
        scenarioId: state.oracle.scenarioId,
        textFieldsMatch: event.textFieldsMatch,
        checkboxChecked: event.checkboxChecked,
        selectionMatch: event.selectionMatch,
        submitted: true,
      };
      return;
    }
    case "scoped-nested-scrolling": {
      const eventName = z.object({ event: z.string() }).passthrough().parse(parsed).event;
      if (eventName === "unchanged_scroll_attempt") {
        unchangedScrollEventSchema.parse(parsed);
        if (state.oracle.unchangedScrollAttemptCount >= MAX_COUNTER) throw new Error("Fixture counter limit reached.");
        state.oracle = {
          ...state.oracle,
          unchangedScrollAttemptCount: state.oracle.unchangedScrollAttemptCount + 1,
        };
        return;
      }
      const event = innerTargetActivatedEventSchema.parse(parsed);
      state.oracle = {
        ...state.oracle,
        innerTargetActivated: true,
        outerScrollChanged: state.oracle.outerScrollChanged || event.outerScrollChanged,
      };
      return;
    }
    case "stale-dynamic-target-recovery": {
      const eventName = z.object({ event: z.string() }).passthrough().parse(parsed).event;
      if (eventName === "rerendered") {
        rerenderedEventSchema.parse(parsed);
        state.oracle = { ...state.oracle, rerendered: true };
        return;
      }
      currentGenerationActivatedEventSchema.parse(parsed);
      state.oracle = { ...state.oracle, currentGenerationActivated: true };
      return;
    }
    case "weak-ax-ocr-visual-point": {
      const eventName = z.object({ event: z.string() }).passthrough().parse(parsed).event;
      if (eventName === "point_attempt") {
        pointAttemptEventSchema.parse(parsed);
        if (state.oracle.pointAttemptCount >= MAX_COUNTER) throw new Error("Fixture counter limit reached.");
        state.oracle = { ...state.oracle, pointAttemptCount: state.oracle.pointAttemptCount + 1 };
        return;
      }
      visualTargetActivatedEventSchema.parse(parsed);
      state.oracle = { ...state.oracle, visualTargetActivated: true };
    }
  }
}

function send(response: ServerResponse, statusCode: number, body?: string, contentType?: string): void {
  response.statusCode = statusCode;
  response.setHeader("cache-control", "no-store");
  if (contentType) response.setHeader("content-type", contentType);
  response.end(body);
}

export async function startComputerFlowWebFixture(): Promise<ComputerFlowWebFixtureHandle> {
  const [htmlTemplate, fixtureScript] = await Promise.all([
    readFile(new URL("./fixtures/index.html", import.meta.url), "utf8"),
    readFile(new URL("./fixtures/fixture.js", import.meta.url), "utf8"),
  ]);
  const sessions = new Map<string, SessionState>();
  let origin = "";

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET" && url.pathname === "/fixture.js") {
          send(response, 200, fixtureScript, "text/javascript; charset=utf-8");
          return;
        }

        const sessionMatch = /^\/session\/([a-f0-9]{36})$/.exec(url.pathname);
        if (request.method === "GET" && sessionMatch) {
          const sessionId = sessionMatch[1]!;
          const state = sessions.get(sessionId);
          if (!state) {
            send(response, 404);
            return;
          }
          state.documentRequestReceived = true;
          send(
            response,
            200,
            htmlTemplate.replaceAll("__SCENARIO_ID__", state.session.scenarioId),
            "text/html; charset=utf-8",
          );
          return;
        }

        const eventMatch = /^\/session\/([a-f0-9]{36})\/event$/.exec(url.pathname);
        if (request.method === "POST" && eventMatch) {
          const state = sessions.get(eventMatch[1]!);
          if (!state) {
            send(response, 404);
            return;
          }
          if ((request.headers["content-type"] ?? "").split(";", 1)[0] !== "application/json") {
            send(response, 400);
            return;
          }
          applyEvent(state, await readJsonBody(request));
          send(response, 204);
          return;
        }

        send(response, 404);
      } catch {
        send(response, 400);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Computer flow fixture did not bind an IPv4 loopback port.");
  }
  origin = `http://127.0.0.1:${address.port}`;
  let closed = false;

  return {
    origin,
    async createSession(scenarioId) {
      if (!WEB_SCENARIOS.includes(scenarioId)) throw new Error("Unsupported computer flow web fixture scenario.");
      const sessionId = randomBytes(18).toString("hex");
      const session: ComputerFlowWebFixtureSession = {
        scenarioId,
        sessionId,
        url: `${origin}/session/${sessionId}`,
      };
      sessions.set(sessionId, { session, oracle: initialOracle(scenarioId), documentRequestReceived: false });
      return session;
    },
    async readOracle(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) throw new Error("Unknown computer flow web fixture session.");
      return structuredClone(state.oracle);
    },
    async readSessionDiagnostics(sessionId) {
      const state = sessions.get(sessionId);
      if (!state || state.oracle.scenarioId !== "open-focus-verify") {
        throw new Error("Unknown computer flow S1 diagnostic session.");
      }
      return {
        documentRequestReceived: state.documentRequestReceived,
        pageReadyEventReceived: state.oracle.pageReady,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      sessions.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
