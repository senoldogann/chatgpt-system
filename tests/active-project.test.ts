import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVE_PROJECT_FILE_NAME, ActiveProjectTracker } from "../src/active-project.js";

const cleanups: string[] = [];

afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture(): Promise<{ stateRoot: string; tracker: ActiveProjectTracker }> {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "cos-active-project-"));
  cleanups.push(stateRoot);
  return { stateRoot, tracker: new ActiveProjectTracker(stateRoot) };
}

describe("ActiveProjectTracker", () => {
  it("kayit yokken null doner", async () => {
    const { tracker } = await fixture();
    await expect(tracker.read()).resolves.toBeNull();
  });

  it("yazilan alias trimlenip kirpilir ve gecici dosya kalmaz", async () => {
    const { stateRoot, tracker } = await fixture();
    await tracker.record(`  ${"a".repeat(200)}  `);
    const entries = await readdir(stateRoot);
    expect(entries).toEqual([ACTIVE_PROJECT_FILE_NAME]);
    const alias = await tracker.read();
    expect(alias).toBe("a".repeat(128));
  });

  it("bos alias yazimini reddeder", async () => {
    const { tracker } = await fixture();
    await expect(tracker.record("   ")).rejects.toThrow("must not be empty");
  });

  it("bozuk izleyici dosyasi yok sayilir", async () => {
    const { stateRoot, tracker } = await fixture();
    await writeFile(path.join(stateRoot, ACTIVE_PROJECT_FILE_NAME), "not-json{{{");
    await expect(tracker.read()).resolves.toBeNull();
  });

  it("son yazilan alias oncekini gecersiz kilar", async () => {
    const { tracker } = await fixture();
    await tracker.record("alpha");
    await tracker.record("beta");
    await expect(tracker.read()).resolves.toBe("beta");
  });
});
