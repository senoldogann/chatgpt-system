import { describe, expect, it } from "vitest";
import { isExistingChromePageEligible } from "../src/existing-chrome-page-policy.js";

describe("existing Chrome page eligibility", () => {
  it("allows only HTTP(S) pages and exact about:blank", () => {
    const allowed = [
      "https://example.com/path?query=1#fragment",
      "http://localhost:3000/",
      "HTTP://EXAMPLE.COM/",
      "about:blank",
    ];
    const refused = [
      "chrome://settings",
      "chrome-untrusted://new-tab-page/",
      "chrome-extension://abcdefghijklmnop/page.html",
      "devtools://devtools/bundled/inspector.html",
      "file:///tmp/test.html",
      "data:text/html,hello",
      "blob:https://example.com/1234",
      "about:blank?unexpected=1",
      "about:srcdoc",
      "javascript:alert(1)",
      "not a url",
      "",
    ];

    for (const url of allowed) expect(isExistingChromePageEligible(url), url).toBe(true);
    for (const url of refused) expect(isExistingChromePageEligible(url), url).toBe(false);
  });
});
