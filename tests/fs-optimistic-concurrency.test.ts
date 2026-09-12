import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import type { LimitsConfig } from "../src/config.js";
import { ConflictError } from "../src/errors.js";
import { FileSystemService } from "../src/fs-service.js";
import { PatchSetService } from "../src/patch-set-service.js";
import { PathPolicy } from "../src/policy.js";

const cleanups: string[] = [];
const ROUNDS = 20;

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

const limits: LimitsConfig = {
  maxReadBytes: 1024 * 1024,
  maxWriteBytes: 1024 * 1024,
  maxDirectoryEntries: 100,
  maxCommandOutputBytes: 1024 * 1024,
  commandTimeoutMs: 5_000,
  maxManagedProcesses: 8,
  maxProcessLogBytesPerStream: 4096,
  processStopGraceMs: 100,
};

interface Fixture {
  root: string;
  fs: FileSystemService;
  patchSet: PatchSetService;
}

async function fixture(): Promise<Fixture> {
  const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-fs-race-"));
  cleanups.push(base);
  const root = path.join(base, "root");
  await mkdir(root);
  const policy = new PathPolicy([root]);
  const audit = new AuditLogger(path.join(base, "audit.jsonl"));
  return {
    root,
    fs: new FileSystemService(policy, audit, limits),
    patchSet: new PatchSetService(policy, audit, path.join(base, "state"), limits),
  };
}

function settledOutcomes(results: PromiseSettledResult<unknown>[]): { fulfilled: number; conflicts: number } {
  return {
    fulfilled: results.filter((item) => item.status === "fulfilled").length,
    conflicts: results.filter((item) => item.status === "rejected" && item.reason instanceof ConflictError).length,
  };
}

function singleLinePatch(from: string, to: string): string {
  return `--- a/race.txt\n+++ b/race.txt\n@@ -1 +1 @@\n-${from}\n+${to}\n`;
}

describe("filesystem optimistic concurrency", () => {
  it("lets only one of two concurrent writes win the same expected hash", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { root, fs } = await fixture();
      const target = path.join(root, "race.txt");
      await writeFile(target, "base\n", "utf8");
      const expectedSha256 = sha256("base\n");

      const results = await Promise.allSettled([
        fs.write("race.txt", "first\n", "utf8", expectedSha256),
        fs.write("race.txt", "second\n", "utf8", expectedSha256),
      ]);

      expect(settledOutcomes(results)).toEqual({ fulfilled: 1, conflicts: 1 });
      expect(["first\n", "second\n"]).toContain(await readFile(target, "utf8"));
    }
  });

  it("lets only one of two concurrent patches win the same expected hash", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { root, fs } = await fixture();
      const target = path.join(root, "race.txt");
      await writeFile(target, "base\n", "utf8");
      const expectedSha256 = sha256("base\n");

      const results = await Promise.allSettled([
        fs.patch("race.txt", singleLinePatch("base", "first"), expectedSha256),
        fs.patch("race.txt", singleLinePatch("base", "second"), expectedSha256),
      ]);

      expect(settledOutcomes(results)).toEqual({ fulfilled: 1, conflicts: 1 });
      expect(["first\n", "second\n"]).toContain(await readFile(target, "utf8"));
    }
  });

  it("does not let a patch set bypass a concurrent filesystem write on the same file", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { root, fs, patchSet } = await fixture();
      const target = path.join(root, "race.txt");
      await writeFile(target, "base\n", "utf8");
      const expectedSha256 = sha256("base\n");

      const results = await Promise.allSettled([
        fs.write("race.txt", "written\n", "utf8", expectedSha256),
        patchSet.apply([{ path: "race.txt", patch: singleLinePatch("base", "patched"), expectedSha256 }]),
      ]);

      expect(settledOutcomes(results)).toEqual({ fulfilled: 1, conflicts: 1 });
      expect(["written\n", "patched\n"]).toContain(await readFile(target, "utf8"));
    }
  });
});
