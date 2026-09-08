import { describe, expect, it } from "vitest";
import { closeRuntimeResources } from "../src/runtime-shutdown.js";

describe("closeRuntimeResources", () => {
  it("stops managed processes before control and transport", async () => {
    const calls: string[] = [];
    await closeRuntimeResources({
      runtime: { processSupervisor: { close: async () => { calls.push("processes"); } } } as never,
      control: { close: async () => { calls.push("control"); } } as never,
      closeTransport: async () => { calls.push("transport"); },
    });
    expect(calls).toEqual(["processes", "control", "transport"]);
  });

  it("continues later cleanup phases after an earlier failure", async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    await closeRuntimeResources({
      runtime: { processSupervisor: { close: async () => { calls.push("processes"); throw new Error("stop failed"); } } } as never,
      control: { close: async () => { calls.push("control"); } } as never,
      closeTransport: async () => { calls.push("transport"); },
      reportError: (phase) => { errors.push(phase); },
    });
    expect(calls).toEqual(["processes", "control", "transport"]);
    expect(errors).toEqual(["processes"]);
  });
});
