import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createComputerFlowNativeFixtureOracleReader,
  type ComputerFlowNativeFixtureOracleSnapshotV1,
} from "../benchmarks/computer-use-flow-performance/native-fixture-oracle.js";

const tempDirs: string[] = [];

async function createOracleFile(snapshot: ComputerFlowNativeFixtureOracleSnapshotV1): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "computer-flow-native-oracle-"));
  tempDirs.push(directory);
  const file = path.join(directory, "oracle.json");
  await writeFile(file, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
  return file;
}

const validSnapshot: ComputerFlowNativeFixtureOracleSnapshotV1 = {
  version: 1,
  ready: true,
  textMatchesExpectedToken: true,
  checkboxChecked: true,
  buttonPressCount: 1,
  textEditCount: 1,
  checkboxToggleCount: 1,
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("computer flow native fixture oracle", () => {
  it("reads only the strict content-safe version-1 snapshot", async () => {
    const file = await createOracleFile(validSnapshot);
    const reader = createComputerFlowNativeFixtureOracleReader(file);

    await expect(reader.read()).resolves.toEqual(validSnapshot);
    const serialized = JSON.stringify(await reader.read());
    for (const forbidden of [
      "native-benchmark",
      "typedText",
      "text\":",
      "status",
      "focus",
      "target",
      "\"x\"",
      "\"y\"",
      "pid",
      "secret",
      "authorityLeaseId",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("rejects missing or extra keys, version mismatch, malformed JSON, and invalid counters", async () => {
    const file = await createOracleFile(validSnapshot);
    const reader = createComputerFlowNativeFixtureOracleReader(file);
    const invalidValues: readonly string[] = [
      JSON.stringify({ ...validSnapshot, version: 2 }),
      JSON.stringify({
        version: 1,
        ready: true,
        textMatchesExpectedToken: true,
        checkboxChecked: true,
        buttonPressCount: 1,
        textEditCount: 1,
      }),
      JSON.stringify({ ...validSnapshot, extra: true }),
      JSON.stringify({ ...validSnapshot, buttonPressCount: -1 }),
      JSON.stringify({ ...validSnapshot, textEditCount: 1.5 }),
      JSON.stringify({ ...validSnapshot, checkboxToggleCount: Number.MAX_SAFE_INTEGER + 1 }),
      "{not-json}",
    ];

    for (const value of invalidValues) {
      await writeFile(file, value, "utf8");
      await expect(reader.read()).rejects.toThrow();
    }
  });

  it("rejects every forbidden content-bearing field instead of redacting it", async () => {
    const file = await createOracleFile(validSnapshot);
    const reader = createComputerFlowNativeFixtureOracleReader(file);
    const forbiddenFields = [
      "text",
      "typedText",
      "status",
      "focus",
      "target",
      "x",
      "y",
      "pid",
      "secret",
      "authorityLeaseId",
    ] as const;

    for (const field of forbiddenFields) {
      await writeFile(file, JSON.stringify({ ...validSnapshot, [field]: "forbidden" }), "utf8");
      await expect(reader.read()).rejects.toThrow();
    }
  });

  it("fails closed when the oracle file disappears", async () => {
    const file = await createOracleFile(validSnapshot);
    const reader = createComputerFlowNativeFixtureOracleReader(file);
    await unlink(file);
    await expect(reader.read()).rejects.toThrow();
  });

  it("does not mutate or rewrite the oracle file while reading", async () => {
    const file = await createOracleFile(validSnapshot);
    const before = await readFile(file, "utf8");
    const reader = createComputerFlowNativeFixtureOracleReader(file);
    await reader.read();
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
