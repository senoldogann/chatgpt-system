import { describe, expect, it } from "vitest";
import { closeRuntimeResources } from "../src/runtime-shutdown.js";

describe("closeRuntimeResources", () => {
  it("stops managed processes and browser before control and transport", async () => {
    const calls: string[] = [];
    await closeRuntimeResources({
      runtime: {
        processSupervisor: { close: async () => { calls.push("processes"); } },
        browser: { close: async () => { calls.push("browser"); return { closed: true as const }; } },
      } as never,
      control: { close: async () => { calls.push("control"); } } as never,
      closeTransport: async () => { calls.push("transport"); },
    });
    expect(calls).toEqual(["processes", "browser", "control", "transport"]);
  });

  it("continues later cleanup phases after process and browser failures", async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    await closeRuntimeResources({
      runtime: {
        processSupervisor: {
          close: async () => {
            calls.push("processes");
            throw new Error("process stop failed");
          },
        },
        browser: {
          close: async () => {
            calls.push("browser");
            throw new Error("browser stop failed");
          },
        },
      } as never,
      control: { close: async () => { calls.push("control"); } } as never,
      closeTransport: async () => { calls.push("transport"); },
      reportError: (phase) => { errors.push(phase); },
    });
    expect(calls).toEqual(["processes", "browser", "control", "transport"]);
    expect(errors).toEqual(["processes", "browser"]);
  });
});
