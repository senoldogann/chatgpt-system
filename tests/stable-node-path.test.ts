import { describe, expect, it } from "vitest";
import { stableNodePath } from "../scripts/stable-node-path.mjs";

function fakeFs(links: Record<string, string>) {
  return {
    existsSync: (candidate: string) => candidate in links,
    realpathSync: (candidate: string) => links[candidate] ?? candidate,
  };
}

const cellar = "/opt/homebrew/Cellar/node/26.7.0/bin/node";

describe("stableNodePath", () => {
  it("replaces a versioned Homebrew Cellar path with the formula's opt link", () => {
    const fs = fakeFs({ "/opt/homebrew/opt/node/bin/node": cellar });
    expect(stableNodePath(cellar, fs)).toBe("/opt/homebrew/opt/node/bin/node");
  });

  it("supports versioned formulas and Intel prefixes", () => {
    const intel = "/usr/local/Cellar/node@22/22.9.0/bin/node";
    const fs = fakeFs({ "/usr/local/opt/node@22/bin/node": intel });
    expect(stableNodePath(intel, fs)).toBe("/usr/local/opt/node@22/bin/node");
  });

  it("keeps the running path when the opt link is missing or points to another version", () => {
    expect(stableNodePath(cellar, fakeFs({}))).toBe(cellar);
    const other = fakeFs({ "/opt/homebrew/opt/node/bin/node": "/opt/homebrew/Cellar/node/27.0.0/bin/node" });
    expect(stableNodePath(cellar, other)).toBe(cellar);
  });

  it("leaves non-Homebrew paths unchanged", () => {
    expect(stableNodePath("/usr/bin/node", fakeFs({}))).toBe("/usr/bin/node");
    expect(stableNodePath("/Users/me/.nvm/versions/node/v22.0.0/bin/node", fakeFs({}))).toBe("/Users/me/.nvm/versions/node/v22.0.0/bin/node");
  });
});
