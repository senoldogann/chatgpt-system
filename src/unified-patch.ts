import { parsePatch } from "diff";
import { ConflictError } from "./errors.js";

/**
 * Reject structurally invalid unified diffs before they reach the diff library.
 * Without this guard `applyPatch` either throws an untyped Error that surfaces as
 * INTERNAL_ERROR, or silently returns the unchanged source for patch text that
 * contains no hunks.
 */
export function validateUnifiedPatch(patchText: string): void {
  let parsed;
  try {
    parsed = parsePatch(patchText);
  } catch {
    throw new ConflictError("Patch is not a valid unified diff.");
  }
  if (parsed.length !== 1 || parsed[0]!.hunks.length < 1) {
    throw new ConflictError("Patch must contain exactly one unified-diff file with at least one hunk.");
  }
  for (const hunk of parsed[0]!.hunks) {
    if (!Number.isInteger(hunk.oldStart)
      || !Number.isInteger(hunk.oldLines)
      || !Number.isInteger(hunk.newStart)
      || !Number.isInteger(hunk.newLines)
      || hunk.oldLines < 0
      || hunk.newLines < 0
      || hunk.lines.length < 1) {
      throw new ConflictError("Patch contains an invalid unified-diff hunk.");
    }
  }
}
