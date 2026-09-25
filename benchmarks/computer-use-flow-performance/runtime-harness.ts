import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { ComputerError } from "../../src/computer/computer-errors.js";
import { ComputerNativeSupervisor } from "../../src/computer/computer-native-supervisor.js";
import { ComputerRuntime, type ComputerNativeRequesting } from "../../src/computer/computer-runtime.js";
import type { ComputerNativeMethod } from "../../src/computer/computer-types.js";
import { loadConfig } from "../../src/core/config.js";
import {
  createComputerFlowNativeFixtureOracleReader,
  type ComputerFlowNativeFixtureOracleReader,
} from "./native-fixture-oracle.js";

export interface ComputerFlowNativeTraceEvent {
  operation: ComputerNativeMethod;
  durationMs: number;
  outcome: "completed" | "timeout" | "unavailable" | "blocked";
}

export interface ComputerFlowNativeTraceHandle extends ComputerNativeRequesting {
  snapshotTrace(): readonly ComputerFlowNativeTraceEvent[];
}

export interface ComputerFlowOwnedNativeFixture {
  oracle: ComputerFlowNativeFixtureOracleReader;
  close(): Promise<void>;
}

export interface ComputerFlowRuntimeHarness {
  computer: ComputerRuntime;
  startOwnedNativeFixture(): Promise<ComputerFlowOwnedNativeFixture>;
  close(): Promise<void>;
}

interface TraceAwareRuntimeHarness extends ComputerFlowRuntimeHarness {
  snapshotNativeTrace?(): readonly ComputerFlowNativeTraceEvent[];
}

function nativeTraceOutcome(error: Error): ComputerFlowNativeTraceEvent["outcome"] {
  if (error instanceof ComputerError) {
    if (error.code === "COMPUTER_TIMEOUT") return "timeout";
    if (error.code === "COMPUTER_UNAVAILABLE" || error.code === "COMPUTER_DISABLED") return "unavailable";
  }
  return "blocked";
}

export function createComputerFlowNativeTrace(
  nativeSupervisor: ComputerNativeRequesting,
): ComputerFlowNativeTraceHandle {
  const trace: ComputerFlowNativeTraceEvent[] = [];
  return {
    healthState() {
      return nativeSupervisor.healthState();
    },
    async request(method, params, timeoutMs) {
      const started = performance.now();
      try {
        const result = await nativeSupervisor.request(method, params, timeoutMs);
        trace.push({ operation: method, durationMs: performance.now() - started, outcome: "completed" });
        return result;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error("Computer native request failed.");
        trace.push({ operation: method, durationMs: performance.now() - started, outcome: nativeTraceOutcome(normalized) });
        throw error;
      }
    },
    close() {
      return nativeSupervisor.close();
    },
    snapshotTrace() {
      return trace.map((event) => ({ ...event }));
    },
  };
}

export function snapshotComputerFlowHarnessNativeTrace(
  harness: ComputerFlowRuntimeHarness,
): readonly ComputerFlowNativeTraceEvent[] | undefined {
  const candidate = harness as TraceAwareRuntimeHarness;
  return candidate.snapshotNativeTrace?.();
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureExecutablePath = path.join(
  repoRoot,
  "native",
  "macos-computer-runtime",
  ".build",
  "staged",
  "ChatGPTSystemComputerRuntimeFixture.app",
  "Contents",
  "MacOS",
  "chatgpt-system-computer-runtime-fixture",
);

async function waitForFixtureReady(
  reader: ComputerFlowNativeFixtureOracleReader,
  child: ChildProcess,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Computer flow native fixture exited before reporting ready.");
    }
    try {
      if ((await reader.read()).ready) return;
    } catch {
      // The fixture creates the oracle atomically after launch.
    }
    if (performance.now() >= deadline) {
      throw new Error("Computer flow native fixture did not report ready in time.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function terminateOwnedFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
}

async function startOwnedNativeFixture(): Promise<ComputerFlowOwnedNativeFixture> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chatgpt-system-computer-flow-fixture-"));
  await chmod(directory, 0o700);
  const oraclePath = path.join(directory, "oracle.json");
  const reader = createComputerFlowNativeFixtureOracleReader(oraclePath);
  const child = spawn(fixtureExecutablePath, [], {
    shell: false,
    stdio: "ignore",
    env: {
      ...process.env,
      CHATGPT_SYSTEM_COMPUTER_FLOW_FIXTURE_ORACLE_PATH: oraclePath,
    },
  });
  let closed = false;
  try {
    await waitForFixtureReady(reader, child);
  } catch (error) {
    await terminateOwnedFixture(child).catch(() => {});
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    oracle: reader,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await terminateOwnedFixture(child);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export async function createComputerFlowRuntimeHarness(): Promise<ComputerFlowRuntimeHarness> {
  const config = await loadConfig({ computerUseEnabled: true });
  const nativeSupervisor = new ComputerNativeSupervisor({
    enabled: config.computerUse.enabled,
    hostBundlePath: config.computerUse.hostBundlePath,
    requestTimeoutMs: config.computerUse.requestTimeoutMs,
  });
  const tracedNative = createComputerFlowNativeTrace(nativeSupervisor);
  const computer = new ComputerRuntime(tracedNative, config.computerUse);
  let closed = false;
  return {
    computer,
    startOwnedNativeFixture,
    snapshotNativeTrace() {
      return tracedNative.snapshotTrace();
    },
    async close() {
      if (closed) return;
      closed = true;
      await computer.close();
    },
  } as TraceAwareRuntimeHarness;
}
