import { readFile } from "node:fs/promises";
import { z } from "zod";

export interface ComputerFlowNativeFixtureOracleSnapshotV1 {
  version: 1;
  ready: boolean;
  textMatchesExpectedToken: boolean;
  checkboxChecked: boolean;
  buttonPressCount: number;
  textEditCount: number;
  checkboxToggleCount: number;
}

export interface ComputerFlowNativeFixtureOracleReader {
  read(): Promise<ComputerFlowNativeFixtureOracleSnapshotV1>;
}

const boundedCounter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const snapshotSchema = z.object({
  version: z.literal(1),
  ready: z.boolean(),
  textMatchesExpectedToken: z.boolean(),
  checkboxChecked: z.boolean(),
  buttonPressCount: boundedCounter,
  textEditCount: boundedCounter,
  checkboxToggleCount: boundedCounter,
}).strict();

export function createComputerFlowNativeFixtureOracleReader(
  path: string,
): ComputerFlowNativeFixtureOracleReader {
  if (path.length === 0) throw new Error("Computer flow native fixture oracle path is required.");
  return {
    async read() {
      const json = await readFile(path, "utf8");
      return snapshotSchema.parse(JSON.parse(json));
    },
  };
}
