import type { z } from "zod";
import type { ComputerTarget } from "./computer-types.js";
import type { JevSystemOneRequest, JevSystemOneResponse } from "./jev-client.js";
import type { computerObservationOutputSchema } from "../mcp/tool-output-schemas.js";

export type ComputerObservationView = z.infer<typeof computerObservationOutputSchema>;
type ComputerElementView = ComputerObservationView["elements"][number];

export type AskJevFn = (request: JevSystemOneRequest) => Promise<JevSystemOneResponse>;

export type SemanticTargetResolution =
  | { readonly outcome: "resolved"; readonly target: ComputerTarget; readonly confidence: number }
  | {
      readonly outcome: "unresolved";
      readonly reason: "no_match" | "low_confidence" | "ambiguous_duplicate";
      readonly confidence: number;
    };

export const JEV_MODEL = "jev-latest";
export const JEV_MAX_ATTEMPTS = 3;
const MIN_RESOLUTION_CONFIDENCE = 0.6;
const NONE_CRITERION_KEY = "none";
const TARGET_QUESTION_ID = "target";

function describeElement(element: ComputerElementView): string {
  const label = element.title ?? element.description ?? "(untitled)";
  return `${element.role} — "${label}"`;
}

function buildCriteria(elements: readonly ComputerElementView[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const element of elements) {
    criteria[String(element.index)] = describeElement(element);
  }
  criteria[NONE_CRITERION_KEY] = "None of the elements match the instruction.";
  return criteria;
}

function serializeElementsAsState(observation: ComputerObservationView): string {
  const header = `Window: ${observation.windowTitle ?? observation.application.name}`;
  const lines = observation.elements.map((element) => {
    const titlePart = element.title !== undefined ? ` title="${element.title}"` : "";
    const descriptionPart = element.description !== undefined ? ` description="${element.description}"` : "";
    return `[${element.index}] role=${element.role}${titlePart}${descriptionPart}`;
  });
  return [header, ...lines].join("\n");
}

// Stres testinde, aralarında ayrım yapacak hiçbir bilgi yokken Jev iki
// özdeş adaydan birini %97 confidence ile seçti. Bu yüzden confidence'a
// ek olarak, seçilen adayla birebir aynı açıklamaya sahip başka bir aday
// varsa sonucu güvenilmez sayıyoruz; confidence eşiği tek başına yeterli değil.
function hasDuplicateDescription(criteria: Readonly<Record<string, string>>, chosenKey: string): boolean {
  const chosenDescription = criteria[chosenKey];
  if (chosenDescription === undefined) return false;
  return Object.entries(criteria).some(([key, description]) => key !== chosenKey && description === chosenDescription);
}

export async function resolveSemanticTarget(
  observation: ComputerObservationView,
  instruction: string,
  askJev: AskJevFn,
): Promise<SemanticTargetResolution> {
  const criteria = buildCriteria(observation.elements);
  const request: JevSystemOneRequest = {
    state: serializeElementsAsState(observation),
    model: JEV_MODEL,
    questions: {
      [TARGET_QUESTION_ID]: {
        type: "choice",
        instructions: `User instruction: "${instruction}". Which element matches this instruction?`,
        criteria,
      },
    },
  };

  const response = await askJev(request);
  const answer = response.answers[TARGET_QUESTION_ID];
  if (answer === undefined) {
    throw new Error(`Jev response is missing the "${TARGET_QUESTION_ID}" answer.`);
  }

  // Kendi verdiğimiz aday kümesinin dışındaki bir anahtar protokol ihlalidir;
  // "eşleşme yok" değildir ve snapshot'ta bulunmayan bir indekse çözülmemelidir.
  if (!Object.prototype.hasOwnProperty.call(criteria, answer.choice)) {
    throw new Error(`Jev returned a choice outside the supplied criteria: "${answer.choice}".`);
  }

  if (answer.choice === NONE_CRITERION_KEY) {
    return { outcome: "unresolved", reason: "no_match", confidence: answer.confidence };
  }
  if (answer.confidence < MIN_RESOLUTION_CONFIDENCE) {
    return { outcome: "unresolved", reason: "low_confidence", confidence: answer.confidence };
  }
  if (hasDuplicateDescription(criteria, answer.choice)) {
    return { outcome: "unresolved", reason: "ambiguous_duplicate", confidence: answer.confidence };
  }

  const elementIndex = Number(answer.choice);
  if (!Number.isInteger(elementIndex)) {
    throw new Error(`Jev returned a non-numeric choice: "${answer.choice}".`);
  }

  return {
    outcome: "resolved",
    target: { by: "index", snapshotId: observation.snapshotId, index: elementIndex },
    confidence: answer.confidence,
  };
}
