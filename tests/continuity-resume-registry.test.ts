import { describe, expect, it } from "vitest";
import { ContinuityResumeRegistry, type ContinuityResumeContext } from "../src/continuity-resume-registry.js";

function context(index = 0): ContinuityResumeContext {
  return {
    projectId: `project-${index}`,
    alias: `Project-${index}`,
    recordVersion: index + 1,
    canonicalWorktree: `/tmp/project-${index}/worktree`,
    repositoryRoot: `/tmp/project-${index}/repo`,
    repositoryIdentity: `repository-${index}`,
    expiresAt: "2030-01-01T00:00:00.000Z",
  };
}

describe("ContinuityResumeRegistry", () => {
  it("stores resume metadata by lease digest and returns defensive copies", () => {
    const registry = new ContinuityResumeRegistry();
    const original = context();
    registry.register("lease-secret-value", original);

    const first = registry.require("lease-secret-value");
    expect(first).toEqual(original);
    first.alias = "mutated";
    expect(registry.require("lease-secret-value").alias).toBe("Project-0");
    expect(JSON.stringify(registry)).not.toContain("lease-secret-value");
    expect(() => registry.require("another-lease")).toThrowError(
      expect.objectContaining({ code: "PROJECT_RESUME_REQUIRED" }),
    );
  });

  it("keeps at most 256 contexts and evicts the oldest digest", () => {
    const registry = new ContinuityResumeRegistry();
    for (let index = 0; index < 257; index += 1) {
      registry.register(`lease-${index}`, context(index));
    }

    expect(() => registry.require("lease-0")).toThrowError(
      expect.objectContaining({ code: "PROJECT_RESUME_REQUIRED" }),
    );
    expect(registry.require("lease-256").projectId).toBe("project-256");
  });
});
