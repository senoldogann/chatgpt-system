import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("ChatGPT custom-app recovery runbook", () => {
  it("documents product-surface MCP loss without pretending the local daemon failed", async () => {
    const [readme, runbook] = await Promise.all([
      readFile(new URL("../README.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/CHATGPT_INTEGRATION.md", import.meta.url), "utf8"),
    ]);

    for (const doc of [readme, runbook]) {
      expect(doc).toContain("This conversation does not support developer MCPs");
      expect(doc).toMatch(/product surface|tool routing/i);
      expect(doc).toMatch(/do not.*daemon/i);
      expect(doc).toMatch(/do not.*local changes|must not.*local changes/i);
      expect(doc).toMatch(/standard text chat/i);
      expect(doc).toMatch(/select|@mention/i);
      expect(doc).toContain("Refresh");
      expect(doc).toContain("project_resume");
      expect(doc).toMatch(/Agent mode.*custom app/i);
      expect(doc).toMatch(/Deep Research.*read\/fetch/i);
    }
  });

  it("keeps README capability and publication claims aligned with the current runtime", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

    expect(readme).toContain("Node.js 22, 24 and 26");
    expect(readme).toContain("Computer Runtime v2 Slice 5");
    expect(readme).toContain("computer_scroll_until_visible");
    expect(readme).toContain("computer_resolve_semantic_target");
    expect(readme).toMatch(/shared-state serialization.*per-page/i);
    expect(readme).toContain("project_check detect");
    expect(readme).toContain("adminAuthorityLeaseId");
    expect(readme).toMatch(/local.*`main`/i);
    expect(readme).toMatch(/non-`main`/i);
  });

  it("documents the bounded Computer Use reliability decision ladder", async () => {
    const runbook = await readFile(new URL("../docs/CHATGPT_INTEGRATION.md", import.meta.url), "utf8");

    expect(runbook).toContain("computer_scroll_until_visible");
    expect(runbook).toMatch(/parentIndex.*depth.*actions.*scroll/is);
    expect(runbook).toMatch(/verified.*completed_unverified/is);
    expect(runbook).toMatch(/semantic AX.*scoped.*scroll.*OCR fallback.*fresh screenshot/is);
    expect(runbook).toMatch(/one.*point attempt/is);
    expect(runbook).toMatch(/unchanged.*point.*scroll/is);
    expect(runbook).toMatch(/candidateCount.*scopeResolved.*activeScrollContainerCount.*recommendedRecovery/is);
    expect(runbook).toMatch(/recovery.*details.*non-sensitive/is);
  });

  it("routes explicit Computer Use web requests to real Google Chrome rather than Playwright", async () => {
    const [readme, runbook] = await Promise.all([
      readFile(new URL("../README.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/CHATGPT_INTEGRATION.md", import.meta.url), "utf8"),
    ]);

    for (const doc of [readme, runbook]) {
      expect(doc).toMatch(/explicit.*Computer Use/i);
      expect(doc).toContain("com.google.Chrome");
      expect(doc).toMatch(/real Google Chrome/i);
      expect(doc).toMatch(/browser_\*.*Playwright/i);
      expect(doc).toMatch(/do not.*Chrome for Testing|never.*Chrome for Testing/i);
      expect(doc).toMatch(/physical (?:mouse|pointer).*keyboard|physical pointer.*keyboard/i);
    }
  });
});
