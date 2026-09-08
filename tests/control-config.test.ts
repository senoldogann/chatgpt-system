import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const saved = {
  enableControl: process.env.CHATGPT_SYSTEM_ENABLE_CONTROL,
  controlSocket: process.env.CHATGPT_SYSTEM_CONTROL_SOCKET,
  maxManagedProcesses: process.env.CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES,
  maxProcessLogBytesPerStream: process.env.CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM,
  processStopGraceMs: process.env.CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS,
};

function restoreEnv(key: keyof NodeJS.ProcessEnv, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restoreEnv("CHATGPT_SYSTEM_ENABLE_CONTROL", saved.enableControl);
  restoreEnv("CHATGPT_SYSTEM_CONTROL_SOCKET", saved.controlSocket);
  restoreEnv("CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES", saved.maxManagedProcesses);
  restoreEnv("CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM", saved.maxProcessLogBytesPerStream);
  restoreEnv("CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS", saved.processStopGraceMs);
});

describe("local authority control configuration", () => {
  it("is disabled by default and uses the private home socket path", async () => {
    delete process.env.CHATGPT_SYSTEM_ENABLE_CONTROL;
    delete process.env.CHATGPT_SYSTEM_CONTROL_SOCKET;

    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.control).toEqual({
      enabled: false,
      socketPath: path.join(homedir(), ".chatgpt-system", "control.sock"),
    });
  });

  it("accepts explicit runtime enablement and an absolute socket path", async () => {
    const config = await loadConfig({
      roots: [process.cwd()],
      controlEnabled: true,
      controlSocketPath: "/tmp/chatgpt-system-control.sock",
    });

    expect(config.control).toEqual({
      enabled: true,
      socketPath: "/tmp/chatgpt-system-control.sock",
    });
  });

  it("supports environment enablement and expands a home-relative socket path", async () => {
    process.env.CHATGPT_SYSTEM_ENABLE_CONTROL = "true";
    process.env.CHATGPT_SYSTEM_CONTROL_SOCKET = "~/.chatgpt-system/custom.sock";

    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.control).toEqual({
      enabled: true,
      socketPath: path.join(homedir(), ".chatgpt-system", "custom.sock"),
    });
  });

  it("rejects relative control socket paths", async () => {
    await expect(loadConfig({
      roots: [process.cwd()],
      controlEnabled: true,
      controlSocketPath: "relative/control.sock",
    })).rejects.toThrow(/control socket/i);
  });

  it("uses bounded managed-process defaults", async () => {
    delete process.env.CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES;
    delete process.env.CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM;
    delete process.env.CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS;

    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.limits).toMatchObject({
      maxManagedProcesses: 32,
      maxProcessLogBytesPerStream: 131_072,
      processStopGraceMs: 3_000,
    });
  });

  it("accepts positive managed-process limits from the environment", async () => {
    process.env.CHATGPT_SYSTEM_MAX_MANAGED_PROCESSES = "7";
    process.env.CHATGPT_SYSTEM_MAX_PROCESS_LOG_BYTES_PER_STREAM = "4096";
    process.env.CHATGPT_SYSTEM_PROCESS_STOP_GRACE_MS = "250";

    const config = await loadConfig({ roots: [process.cwd()] });

    expect(config.limits).toMatchObject({
      maxManagedProcesses: 7,
      maxProcessLogBytesPerStream: 4_096,
      processStopGraceMs: 250,
    });
  });
});
