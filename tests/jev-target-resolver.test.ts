import { describe, expect, it } from "vitest";
import type { JevSystemOneRequest, JevSystemOneResponse } from "../src/jev-client.js";
import { resolveSemanticTarget, type ComputerObservationView } from "../src/jev-target-resolver.js";

function buildObservation(
  elements: ComputerObservationView["elements"],
): ComputerObservationView {
  return {
    snapshotId: "snap-1",
    application: { name: "Fixture", frontmost: true },
    windowTitle: "Fixture Window",
    elements,
    truncated: false,
    perception: {
      axQuality: "strong",
      webContentAccessible: false,
      ocrUsed: false,
      recommendedTargeting: "ax",
      ocrCandidates: [],
    },
  };
}

function buildElement(
  index: number,
  role: string,
  title: string,
): ComputerObservationView["elements"][number] {
  return { index, parentIndex: null, depth: 0, role, title, actions: [], scroll: { scrollable: false, axes: [] } };
}

function fixedAnswer(response: JevSystemOneResponse): (request: JevSystemOneRequest) => Promise<JevSystemOneResponse> {
  return async () => response;
}

describe("resolveSemanticTarget", () => {
  it("resolves to the chosen index when the answer is confident and unambiguous", async () => {
    const observation = buildObservation([
      buildElement(0, "AXWindow", "Compose"),
      buildElement(1, "AXButton", "Send"),
      buildElement(2, "AXButton", "Cancel"),
    ]);
    const askJev = fixedAnswer({
      model: "jev-1.0.0",
      answers: { target: { type: "choice", choice: "1", confidence: 0.95, probabilities: { "1": 0.95 } } },
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await resolveSemanticTarget(observation, "Click the Send button", askJev);

    expect(result).toEqual({
      outcome: "resolved",
      target: { by: "index", snapshotId: "snap-1", index: 1 },
      confidence: 0.95,
    });
  });

  it("returns no_match when Jev selects the explicit none option", async () => {
    const observation = buildObservation([buildElement(0, "AXWindow", "Compose")]);
    const askJev = fixedAnswer({
      model: "jev-1.0.0",
      answers: { target: { type: "choice", choice: "none", confidence: 0.8, probabilities: { none: 0.8 } } },
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await resolveSemanticTarget(observation, "Make the text bold", askJev);

    expect(result).toEqual({ outcome: "unresolved", reason: "no_match", confidence: 0.8 });
  });

  it("returns low_confidence when the answer falls below the resolution threshold", async () => {
    const observation = buildObservation([buildElement(0, "AXButton", "Send")]);
    const askJev = fixedAnswer({
      model: "jev-1.0.0",
      answers: { target: { type: "choice", choice: "0", confidence: 0.4, probabilities: { "0": 0.4 } } },
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await resolveSemanticTarget(observation, "Click something", askJev);

    expect(result).toEqual({ outcome: "unresolved", reason: "low_confidence", confidence: 0.4 });
  });

  it("returns ambiguous_duplicate for a confidently-chosen element whose description duplicates another candidate's, even at high confidence", async () => {
    const observation = buildObservation([
      buildElement(2, "AXButton", "Delete"),
      buildElement(4, "AXButton", "Delete"),
    ]);
    const askJev = fixedAnswer({
      model: "jev-1.0.0",
      answers: { target: { type: "choice", choice: "2", confidence: 0.97, probabilities: { "2": 0.98, "4": 0.02 } } },
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await resolveSemanticTarget(observation, "Click Delete", askJev);

    expect(result).toEqual({ outcome: "unresolved", reason: "ambiguous_duplicate", confidence: 0.97 });
  });

  it("refuses a choice key that is not one of the supplied criteria", async () => {
    const observation = buildObservation([
      buildElement(0, "AXWindow", "Compose"),
      buildElement(1, "AXButton", "Send"),
    ]);
    // Jev, kendi verdiğimiz aday kümesinin dışından sayısal bir anahtar döndürürse
    // snapshot'ta bulunmayan bir hedefe çözülmemeli; fail-closed olmalı.
    const answer = fixedAnswer({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "999", confidence: 0.99, probabilities: {} } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(resolveSemanticTarget(observation, "send it", answer)).rejects.toThrow();
  });

  it("refuses a non-numeric choice key", async () => {
    const observation = buildObservation([buildElement(0, "AXButton", "Send")]);
    const answer = fixedAnswer({
      model: "jev-latest",
      answers: { target: { type: "choice", choice: "not-an-index", confidence: 0.99, probabilities: {} } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(resolveSemanticTarget(observation, "send it", answer)).rejects.toThrow();
  });

  it("throws when the response is missing the expected answer", async () => {
    const observation = buildObservation([buildElement(0, "AXButton", "Send")]);
    const askJev = fixedAnswer({
      model: "jev-1.0.0",
      answers: {},
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(resolveSemanticTarget(observation, "Click Send", askJev)).rejects.toThrow(/missing/i);
  });
});
