import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const saved = {
  enableControl: process.env.CHATGPT_SYSTEM_ENABLE_CONTROL,
  controlSocket: process.env.CHATGPT_SYSTEM_CONTROL_SOCKET,
};

afterEach(() => {
  if (saved.enableControl === undefined) delete process.env.CHATGPT_SYSTEM_ENABLE_CONTROL;
  else process.env.CHATGPT_SYSTEM_ENABLE_CONTROL = saved.enableControl;
  if (saved.controlSocket === undefined) delete process.env.CHATGPT_SYSTEM_CONTROL_SOCKET;
  else process.env.CHATGPT_SYSTEM_CONTROL_SOCKET = saved.controlSocket;
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
});
