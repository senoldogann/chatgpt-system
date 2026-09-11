import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("existing Chrome operator documentation", () => {
  it("documents explicit consent, safe attach flags, lifecycle ownership, and privacy boundaries", async () => {
    const doc = await readFile(new URL("../docs/EXISTING_CHROME_ATTACH.md", import.meta.url), "utf8");

    expect(doc).toContain("chrome://inspect/#remote-debugging");
    expect(doc).toContain("--enable-browser --browser-existing-chrome");
    expect(doc).toContain("Chrome 144+");
    expect(doc).toContain("Allow remote debugging for this browser instance");
    expect(doc).toContain("does not close your Chrome process");
    expect(doc).toContain("cookies are not exported");
    expect(doc).toContain("http:");
    expect(doc).toContain("https:");
    expect(doc).toContain("about:blank");
    expect(doc).toContain("chrome:");
    expect(doc).toContain("chrome-extension:");
    expect(doc).toContain("devtools:");
    expect(doc).toContain("--browser-existing-chrome-user-data-dir");

    expect(doc).not.toContain("--remote-debugging-port");
    expect(doc).not.toContain("--remote-debugging-pipe");
    expect(doc).not.toContain("ws://127.0.0.1:");
  });
});
