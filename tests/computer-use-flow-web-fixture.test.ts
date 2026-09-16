import { afterEach, describe, expect, it } from "vitest";
import {
  startComputerFlowWebFixture,
  type ComputerFlowWebFixtureHandle,
  type ComputerFlowWebFixtureSession,
  type ComputerFlowWebOracle,
} from "../benchmarks/computer-use-flow-performance/web-fixture.js";

const handles: ComputerFlowWebFixtureHandle[] = [];

async function startFixture(): Promise<ComputerFlowWebFixtureHandle> {
  const handle = await startComputerFlowWebFixture();
  handles.push(handle);
  return handle;
}

async function postEvent(
  session: ComputerFlowWebFixtureSession,
  body: Record<string, boolean | number | string>,
): Promise<Response> {
  return fetch(`${session.url}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

const scenarioCases: readonly {
  scenarioId: ComputerFlowWebFixtureSession["scenarioId"];
  initial: ComputerFlowWebOracle;
  events: readonly Record<string, boolean | number | string>[];
  final: ComputerFlowWebOracle;
}[] = [
  {
    scenarioId: "open-focus-verify",
    initial: { scenarioId: "open-focus-verify", pageReady: false },
    events: [{ event: "page_ready" }],
    final: { scenarioId: "open-focus-verify", pageReady: true },
  },
  {
    scenarioId: "batched-multi-control-form",
    initial: {
      scenarioId: "batched-multi-control-form",
      textFieldsMatch: false,
      checkboxChecked: false,
      selectionMatch: false,
      submitted: false,
    },
    events: [{
      event: "form_submitted",
      textFieldsMatch: true,
      checkboxChecked: true,
      selectionMatch: true,
    }],
    final: {
      scenarioId: "batched-multi-control-form",
      textFieldsMatch: true,
      checkboxChecked: true,
      selectionMatch: true,
      submitted: true,
    },
  },
  {
    scenarioId: "scoped-nested-scrolling",
    initial: {
      scenarioId: "scoped-nested-scrolling",
      innerTargetActivated: false,
      outerScrollChanged: false,
      unchangedScrollAttemptCount: 0,
    },
    events: [
      { event: "unchanged_scroll_attempt" },
      { event: "inner_target_activated", outerScrollChanged: false },
    ],
    final: {
      scenarioId: "scoped-nested-scrolling",
      innerTargetActivated: true,
      outerScrollChanged: false,
      unchangedScrollAttemptCount: 1,
    },
  },
  {
    scenarioId: "stale-dynamic-target-recovery",
    initial: {
      scenarioId: "stale-dynamic-target-recovery",
      rerendered: false,
      currentGenerationActivated: false,
    },
    events: [
      { event: "rerendered" },
      { event: "current_generation_activated" },
    ],
    final: {
      scenarioId: "stale-dynamic-target-recovery",
      rerendered: true,
      currentGenerationActivated: true,
    },
  },
  {
    scenarioId: "weak-ax-ocr-visual-point",
    initial: {
      scenarioId: "weak-ax-ocr-visual-point",
      visualTargetActivated: false,
      pointAttemptCount: 0,
    },
    events: [
      { event: "point_attempt" },
      { event: "visual_target_activated" },
    ],
    final: {
      scenarioId: "weak-ax-ocr-visual-point",
      visualTargetActivated: true,
      pointAttemptCount: 1,
    },
  },
];

describe("computer flow web fixture", () => {
  it("binds loopback-only and exposes deterministic isolated sessions for all five web scenarios", async () => {
    const fixture = await startFixture();
    expect(fixture.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    for (const scenarioCase of scenarioCases) {
      const first = await fixture.createSession(scenarioCase.scenarioId);
      const second = await fixture.createSession(scenarioCase.scenarioId);
      expect(first.sessionId).not.toBe(second.sessionId);
      expect(first.url).toBe(`${fixture.origin}/session/${first.sessionId}`);

      const page = await fetch(first.url);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await fixture.readOracle(first.sessionId)).toEqual(scenarioCase.initial);
      expect(await fixture.readOracle(second.sessionId)).toEqual(scenarioCase.initial);

      for (const event of scenarioCase.events) {
        const response = await postEvent(first, event);
        expect(response.status).toBe(204);
      }

      expect(await fixture.readOracle(first.sessionId)).toEqual(scenarioCase.final);
      expect(await fixture.readOracle(second.sessionId)).toEqual(scenarioCase.initial);
    }
  });

  it("rejects unknown paths, malformed events, unknown events, and generic completion shortcuts", async () => {
    const fixture = await startFixture();
    const session = await fixture.createSession("batched-multi-control-form");

    expect((await fetch(`${fixture.origin}/not-a-session`)).status).toBe(404);
    expect((await fetch(`${fixture.origin}/complete`, { method: "POST" })).status).toBe(404);
    expect((await postEvent(session, { event: "complete" })).status).toBe(400);
    expect((await postEvent(session, {
      event: "form_submitted",
      textFieldsMatch: "yes",
      checkboxChecked: true,
      selectionMatch: true,
    })).status).toBe(400);
    expect((await postEvent(session, {
      event: "form_submitted",
      textFieldsMatch: true,
      checkboxChecked: true,
      selectionMatch: true,
      typedText: "alpha",
    })).status).toBe(400);

    expect(await fixture.readOracle(session.sessionId)).toEqual({
      scenarioId: "batched-multi-control-form",
      textFieldsMatch: false,
      checkboxChecked: false,
      selectionMatch: false,
      submitted: false,
    });
  });

  it("never returns fixed form tokens, request text, coordinates, or arbitrary content in oracle state", async () => {
    const fixture = await startFixture();
    const session = await fixture.createSession("weak-ax-ocr-visual-point");
    expect((await postEvent(session, { event: "point_attempt" })).status).toBe(204);
    expect((await postEvent(session, { event: "visual_target_activated" })).status).toBe(204);

    const serialized = JSON.stringify(await fixture.readOracle(session.sessionId));
    for (const forbidden of [
      "alpha",
      "bravo",
      "charlie",
      "option-b",
      "native-benchmark",
      "typedText",
      "ocrText",
      "targetLabel",
      "\"x\"",
      "\"y\"",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
