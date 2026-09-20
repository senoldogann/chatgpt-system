import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const testsDirectory = path.resolve("tests");

/**
 * The operator's real audit log (`~/.chatgpt-system/audit.jsonl`) is the evidence we classify
 * MCP failure boundaries from, so the test suite must never append to it. Any test that builds
 * runtime services is one forgotten `auditFile` away from doing exactly that: two suites did it
 * for a while, adding roughly 20 fixture rows (`authority.start` with an Admin profile,
 * `shell.run`, `terminal.session.*`, `process.run`, `fs.patch`, `git.read`) to the live log on
 * every `npm run check`. This guard keeps that class of pollution from coming back.
 */
describe("test suite audit isolation", () => {
  it("keeps every runtime-building test away from the operator's audit log", () => {
    const count = (source: string, needle: string) => source.split(needle).length - 1;
    const offenders = readdirSync(testsDirectory)
      .filter((name) => name.endsWith(".test.ts"))
      .filter((name) => {
        const source = readFileSync(path.join(testsDirectory, name), "utf8");
        // Counting rather than presence matters: a file with two fixtures and one audit override
        // left the second runtime pointed at the operator's log.
        return count(source, "createRuntimeServices(") > count(source, "auditFile");
      });

    expect(offenders).toEqual([]);
  });

  it("does not spell out the operator's audit path anywhere in the suite", () => {
    const offenders = readdirSync(testsDirectory)
      .filter((name) => name.endsWith(".test.ts"))
      .filter((name) => {
        const source = readFileSync(path.join(testsDirectory, name), "utf8");
        return /\.chatgpt-system["'`]\s*,\s*["'`]audit\.jsonl/.test(source);
      });

    expect(offenders).toEqual([]);
  });
});
