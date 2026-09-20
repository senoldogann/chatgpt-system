import { describe, expect, it } from "vitest";
import {
  beginChromeProcessOracle,
  createChromeProcessSnapshotProvider,
  finishChromeProcessOracle,
  type ChromeProcessSnapshotProvider,
} from "../benchmarks/computer-use-flow-performance/host-oracle.js";

function provider(...snapshots: readonly (readonly number[])[]): ChromeProcessSnapshotProvider {
  let index = 0;
  return {
    async snapshotMainProcessIds() {
      return snapshots[index++] ?? [];
    },
  };
}

describe("computer flow Chrome host oracle", () => {
  it("requires every pre-existing Chrome main process to survive while allowing extras", async () => {
    const preserved = provider([101, 202], [101, 202, 303]);
    const preservedSession = await beginChromeProcessOracle(preserved);
    await expect(finishChromeProcessOracle(preservedSession, preserved)).resolves.toMatchObject({
      assertion: "chrome_process_preserved",
      status: "pass",
      source: "host_process_oracle",
    });

    const partialReplacement = provider([101, 202], [101, 303]);
    const partialSession = await beginChromeProcessOracle(partialReplacement);
    await expect(finishChromeProcessOracle(partialSession, partialReplacement)).resolves.toMatchObject({
      assertion: "chrome_process_preserved",
      status: "fail",
      source: "host_process_oracle",
    });

    const restarted = provider([101], [303]);
    const restartedSession = await beginChromeProcessOracle(restarted);
    await expect(finishChromeProcessOracle(restartedSession, restarted)).resolves.toMatchObject({ status: "fail" });

    const initiallyClosed = provider([], [303]);
    const initiallyClosedSession = await beginChromeProcessOracle(initiallyClosed);
    await expect(finishChromeProcessOracle(initiallyClosedSession, initiallyClosed)).resolves.toMatchObject({ status: "pass" });
  });

  it("returns unavailable when the post-run provider cannot produce a trustworthy snapshot", async () => {
    const session = await beginChromeProcessOracle(provider([101, 202]));
    const failing: ChromeProcessSnapshotProvider = {
      async snapshotMainProcessIds() {
        throw new Error("pgrep unavailable");
      },
    };
    await expect(finishChromeProcessOracle(session, failing)).resolves.toEqual({
      assertion: "chrome_process_preserved",
      status: "unavailable",
      reason: "collector_source_missing",
    });
  });

  it("keeps raw process identifiers out of the serialized categorical result", async () => {
    const snapshots = provider([918271, 736452], [918271, 736452, 551199]);
    const session = await beginChromeProcessOracle(snapshots);
    const result = await finishChromeProcessOracle(session, snapshots);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("918271");
    expect(serialized).not.toContain("736452");
    expect(serialized).not.toContain("551199");
  });

  it("uses exact shell-free pgrep semantics and accepts only a unique positive PID set", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const ok = createChromeProcessSnapshotProvider(async (file, args) => {
      calls.push({ file, args });
      return { exitCode: 0, stdout: "101\n202\n" };
    });
    await expect(ok.snapshotMainProcessIds()).resolves.toEqual([101, 202]);
    expect(calls).toEqual([{ file: "/usr/bin/pgrep", args: ["-x", "Google Chrome"] }]);

    const absent = createChromeProcessSnapshotProvider(async () => ({ exitCode: 1, stdout: "" }));
    await expect(absent.snapshotMainProcessIds()).resolves.toEqual([]);

    for (const stdout of ["101\n101\n", "0\n", "-1\n", "not-a-pid\n", "101 extra\n"]) {
      const malformed = createChromeProcessSnapshotProvider(async () => ({ exitCode: 0, stdout }));
      await expect(malformed.snapshotMainProcessIds()).rejects.toThrow();
    }

    const failed = createChromeProcessSnapshotProvider(async () => ({ exitCode: 2, stdout: "" }));
    await expect(failed.snapshotMainProcessIds()).rejects.toThrow();
  });
});
