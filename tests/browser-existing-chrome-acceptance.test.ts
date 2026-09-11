import { afterEach, describe, expect, it } from "vitest";
import { createBrowserService } from "../src/browser-factory.js";
import { loadConfig } from "../src/config.js";
import { isExistingChromePageEligible } from "../src/existing-chrome-page-policy.js";

const acceptanceEnabled = process.env.CHATGPT_SYSTEM_ACCEPT_EXISTING_CHROME === "1";
let closeCurrent: (() => Promise<unknown>) | null = null;

afterEach(async () => {
  const close = closeCurrent;
  closeCurrent = null;
  if (close) await close();
});

describe.skipIf(!acceptanceEnabled)("real existing Chrome acceptance", () => {
  it("attaches through the production path and sees at least one eligible existing tab without reading page content", async () => {
    const config = await loadConfig({
      roots: [process.cwd()],
      browserEnabled: true,
      browserExistingChrome: true,
    });
    const service = createBrowserService(config);
    closeCurrent = () => service.close();

    const health = await service.health();
    expect(health).toMatchObject({ enabled: true });

    const { tabs } = await service.tabs();
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      expect(isExistingChromePageEligible(tab.url)).toBe(true);
    }
  });
});
