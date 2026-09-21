import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("SessionEventStore operator documentation", () => {
  it.each(["README.md", "docs/ARCHITECTURE.md"])("documents the privacy and activation boundary in %s", async (file) => {
    const text = await readFile(file, "utf8");
    expect(text).toMatch(/SessionEventStore/);
    expect(text).toMatch(/metadata/i);
    expect(text).toMatch(/disabled by default/i);
    expect(text).toMatch(/separate.*Continuity/i);
    expect(text).toMatch(/internal-only|internal API/i);
    expect(text).toMatch(/no verified.*ChatGPT conversation binding/i);
    expect(text).toMatch(/no transcript.*tool.*bod/i);
    expect(text).toMatch(/no automatic capture/i);
    expect(text).toMatch(/no deployment.*restart/i);
  });

  it("links to the approved spec and reserves external evidence/encryption for separate work", async () => {
    const architecture = await readFile("docs/ARCHITECTURE.md", "utf8");
    expect(architecture).toContain("docs/superpowers/specs/2026-09-21-session-event-store-metadata-design.md");
    expect(architecture).toMatch(/separate.*provider.*encryption/i);
  });

  it("lists session metadata shutdown before Continuity and control/transport", async () => {
    const architecture = await readFile("docs/ARCHITECTURE.md", "utf8");
    const shutdown = architecture.split("## Runtime shutdown\n")[1]?.split("## Audit boundary")[0] ?? "";
    expect(shutdown).toMatch(/SessionEventStore[\s\S]*Continuity[\s\S]*control[\s\S]*transport/i);
  });
});
