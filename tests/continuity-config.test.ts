import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const originalDatabasePath = process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE;

afterEach(() => {
  if (originalDatabasePath === undefined) delete process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE;
  else process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE = originalDatabasePath;
});

describe("project continuity configuration", () => {
  it("uses bounded local persistence defaults", async () => {
    delete process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE;
    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.continuity).toEqual({
      databasePath: path.join(homedir(), ".chatgpt-system", "continuity", "continuity.db"),
      maxResumeChars: 12_000,
      maxTrackedPaths: 100,
      remoteVerificationTimeoutMs: 10_000,
    });
  });

  it("accepts an absolute database override and rejects a relative path", async () => {
    process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE = path.join(process.cwd(), ".tmp", "continuity.db");
    const configured = await loadConfig({ roots: [process.cwd()] });
    expect(configured.continuity.databasePath).toBe(process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE);

    process.env.CHATGPT_SYSTEM_CONTINUITY_DATABASE = "relative/continuity.db";
    await expect(loadConfig({ roots: [process.cwd()] })).rejects.toThrow(/Continuity database path must be absolute/i);
  });
});
