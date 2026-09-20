import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  COMPUTER_FLOW_ASSERTIONS,
  COMPUTER_FLOW_ASSERTION_SOURCES,
  COMPUTER_FLOW_OPERATIONS,
  COMPUTER_FLOW_OUTCOMES,
  COMPUTER_FLOW_SCENARIO_IDS,
  COMPUTER_FLOW_MODES,
  type ComputerFlowEvidenceMetadataV1,
  type ComputerFlowRunRecord,
} from "./contract.js";

type CanonicalInput = string | number | boolean | null | readonly CanonicalInput[] | object;

const evidenceMetadataSchema = z.object({
  version: z.literal(1),
  scenarioId: z.enum(COMPUTER_FLOW_SCENARIO_IDS),
  mode: z.enum(COMPUTER_FLOW_MODES),
  assertion: z.enum(COMPUTER_FLOW_ASSERTIONS),
  status: z.enum(["pass", "fail"]),
  source: z.enum(COMPUTER_FLOW_ASSERTION_SOURCES),
  sourceSequence: z.number().int().nonnegative(),
  operation: z.enum(COMPUTER_FLOW_OPERATIONS).optional(),
  outcome: z.enum(COMPUTER_FLOW_OUTCOMES).optional(),
}).strict();

function requireCollectorKey(collectorKey: Uint8Array): void {
  if (collectorKey.byteLength < 32) throw new Error("Computer flow collector key must contain at least 32 bytes.");
}

function canonicalize(value: CanonicalInput): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical computer flow data cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => {
    if (item === undefined) throw new Error("Canonical computer flow data cannot contain undefined values.");
    return `${JSON.stringify(key)}:${canonicalize(item as CanonicalInput)}`;
  }).join(",")}}`;
}

export function canonicalComputerFlowJson(value: CanonicalInput): string {
  return canonicalize(value);
}

function hmacHex(domain: string, value: CanonicalInput, collectorKey: Uint8Array): string {
  requireCollectorKey(collectorKey);
  return createHmac("sha256", collectorKey)
    .update(domain)
    .update(canonicalComputerFlowJson(value))
    .digest("hex");
}

export function createEvidenceDigest(metadata: ComputerFlowEvidenceMetadataV1, collectorKey: Uint8Array): string {
  const parsed = evidenceMetadataSchema.parse(metadata) as ComputerFlowEvidenceMetadataV1;
  return hmacHex("computer-use-flow-evidence-v1\0", parsed, collectorKey);
}

function unsignedRecord(record: ComputerFlowRunRecord): Omit<ComputerFlowRunRecord, "collectorSignature"> {
  const { collectorSignature: _collectorSignature, ...unsigned } = record;
  return unsigned;
}

export function signComputerFlowRun(
  record: Omit<ComputerFlowRunRecord, "collectorSignature">,
  collectorKey: Uint8Array,
): ComputerFlowRunRecord {
  const collectorSignature = hmacHex(
    "computer-use-flow-record-v1\0",
    record,
    collectorKey,
  );
  return { ...record, collectorSignature };
}

export function verifyComputerFlowRunSignature(record: ComputerFlowRunRecord, collectorKey: Uint8Array): boolean {
  requireCollectorKey(collectorKey);
  if (!/^[a-f0-9]{64}$/.test(record.collectorSignature)) return false;
  const expected = hmacHex(
    "computer-use-flow-record-v1\0",
    unsignedRecord(record),
    collectorKey,
  );
  const actualBytes = Buffer.from(record.collectorSignature, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return actualBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(actualBytes, expectedBytes);
}
