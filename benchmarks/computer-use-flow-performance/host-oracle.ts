import { execFile } from "node:child_process";

export interface ChromeProcessSnapshotProvider {
  snapshotMainProcessIds(): Promise<readonly number[]>;
}

export interface ChromeProcessOracleSession {
  preRunMainProcessIds: readonly number[];
}

export type ChromeProcessPreservationAssertion =
  | {
      assertion: "chrome_process_preserved";
      status: "pass" | "fail";
      source: "host_process_oracle";
    }
  | {
      assertion: "chrome_process_preserved";
      status: "unavailable";
      reason: "collector_source_missing";
    };

export interface ChromeProcessExecResult {
  exitCode: number;
  stdout: string;
}

export type ChromeProcessExec = (
  file: string,
  args: readonly string[],
) => Promise<ChromeProcessExecResult>;

async function defaultChromeProcessExec(
  file: string,
  args: readonly string[],
): Promise<ChromeProcessExecResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: "utf8" }, (error, stdout) => {
      if (!error) {
        resolve({ exitCode: 0, stdout });
        return;
      }
      if (typeof error.code === "number") {
        resolve({ exitCode: error.code, stdout });
        return;
      }
      reject(new Error("Chrome process snapshot command failed."));
    });
  });
}

function parseChromeProcessIds(stdout: string): readonly number[] {
  if (stdout.length === 0) return [];
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  const values: number[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    if (!/^[1-9][0-9]*$/.test(line)) {
      throw new Error("Chrome process snapshot contained a malformed process identifier.");
    }
    const value = Number(line);
    if (!Number.isSafeInteger(value) || value <= 0 || seen.has(value)) {
      throw new Error("Chrome process snapshot contained an invalid process identifier set.");
    }
    seen.add(value);
    values.push(value);
  }
  return values;
}

export function createChromeProcessSnapshotProvider(
  run: ChromeProcessExec = defaultChromeProcessExec,
): ChromeProcessSnapshotProvider {
  return {
    async snapshotMainProcessIds() {
      const result = await run("/usr/bin/pgrep", ["-x", "Google Chrome"]);
      if (result.exitCode === 1) return [];
      if (result.exitCode !== 0) throw new Error("Chrome process snapshot command was unavailable.");
      return parseChromeProcessIds(result.stdout);
    },
  };
}

export async function beginChromeProcessOracle(
  provider: ChromeProcessSnapshotProvider,
): Promise<ChromeProcessOracleSession> {
  return { preRunMainProcessIds: [...await provider.snapshotMainProcessIds()] };
}

export async function finishChromeProcessOracle(
  session: ChromeProcessOracleSession,
  provider: ChromeProcessSnapshotProvider,
): Promise<ChromeProcessPreservationAssertion> {
  try {
    const postRunMainProcessIds = new Set(await provider.snapshotMainProcessIds());
    const preserved = session.preRunMainProcessIds.every((processId) => postRunMainProcessIds.has(processId));
    return {
      assertion: "chrome_process_preserved",
      status: preserved ? "pass" : "fail",
      source: "host_process_oracle",
    };
  } catch {
    return {
      assertion: "chrome_process_preserved",
      status: "unavailable",
      reason: "collector_source_missing",
    };
  }
}
