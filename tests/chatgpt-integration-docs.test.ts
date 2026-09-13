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
