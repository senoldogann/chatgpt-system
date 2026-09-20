import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const agentsPath = path.resolve("AGENTS.md");

async function readAgents() {
  return readFile(agentsPath, "utf8");
}

describe("risk-tiered development protocol", () => {
  it("defines three risk tiers with proportionate verification", async () => {
    const agents = await readAgents();
    const procedure = agents.split("## Risk-tiered development and verification")[1]?.split("\n## ")[0] ?? "";
    const low = procedure.split("### Tier 1: Low risk")[1]?.split("### Tier 2: Normal risk")[0] ?? "";
    const normal = procedure.split("### Tier 2: Normal risk")[1]?.split("### Tier 3: Critical risk")[0] ?? "";
    const critical = procedure.split("### Tier 3: Critical risk")[1] ?? "";

    expect(low).toMatch(/documentation.*narrow change/i);
    expect(low).toMatch(/relevant.*tests/i);
    expect(low).toMatch(/short.*status/i);
    expect(normal).toMatch(/feature.*bug fix/i);
    expect(normal).toMatch(/focused tests.*during.*implementation/i);
    expect(normal).toMatch(/full.*verification.*completion/i);
    expect(critical).toMatch(/security.*authority.*data loss.*publication.*deployment/i);
    expect(critical).toMatch(/comprehensive.*verification/i);
    expect(procedure).toMatch(/failing.*test.*before.*fix/i);
  });

  it("makes Project Continuity primary and limits the handoff file to significant events", async () => {
    const agents = await readAgents();
    const record = agents.split("## Handoff and checkpoint discipline")[1]?.split("\n## ")[0] ?? "";

    expect(record).toMatch(/Project Continuity.*primary.*working record/i);
    expect(record).toMatch(/docs\/PROJECT_STATE\.md.*significant decision.*handoff.*delivery/i);
    expect(record).toMatch(/do not.*duplicate.*every small step/i);
    expect(record).toMatch(/project_checkpoint.*before.*handoff/i);
    expect(record).toContain("Next exact step");
  });

  it("keeps identity, fail-closed, ownership, exact-head publication and live-deployment authorization", async () => {
    const agents = await readAgents();

    expect(agents).toMatch(/actual valid.*authorityLeaseId/i);
    expect(agents).toMatch(/fail-closed/i);
    expect(agents).toContain("Never reset, clean, revert, overwrite, or delete another agent's work");
    expect(agents).toMatch(/exact.*HEAD.*workingTreeDigest/i);
    expect(agents).toMatch(/live deployment.*explicit.*authorization/i);
    expect(agents).toMatch(/Develop directly on `main` by default/i);
    expect(agents).toMatch(/create a branch only when the user explicitly requests one/i);
    expect(agents).toMatch(/Do not develop directly on `main` when another active owner/i);
    expect(agents).toMatch(/commit, push, PR, merge, and deployment are separate/i);
  });

  it("keeps ordinary development on main while preserving publication boundaries", async () => {
    const agents = await readAgents();

    expect(agents).toMatch(/authoritative checkout on `main` by default/i);
    expect(agents).toMatch(/non-`main` clean worktree/i);
    expect(agents).toMatch(/fresh `project_check` PASS/i);
    expect(agents).toMatch(/exact `HEAD`.*workingTreeDigest/i);
  });
});
