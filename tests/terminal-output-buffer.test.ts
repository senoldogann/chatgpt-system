import { describe, expect, it } from "vitest";
import { TerminalOutputBuffer } from "../src/terminal-output-buffer.js";

describe("TerminalOutputBuffer", () => {
  it("uses monotonic event sequences without duplicating already-read output", () => {
    const buffer = new TerminalOutputBuffer(1024);
    expect(buffer.append("alpha")).toBe(1);
    expect(buffer.append("beta")).toBe(2);

    expect(buffer.read(0)).toEqual({
      data: "alphabeta",
      bytes: 9,
      nextSequence: 2,
      truncatedBefore: false,
    });
    expect(buffer.read(1)).toEqual({
      data: "beta",
      bytes: 4,
      nextSequence: 2,
      truncatedBefore: false,
    });
    expect(buffer.read(2)).toEqual({
      data: "",
      bytes: 0,
      nextSequence: 2,
      truncatedBefore: false,
    });
  });

  it("drops oldest complete chunks first and reports a cursor gap", () => {
    const buffer = new TerminalOutputBuffer(8);
    buffer.append("aaaa"); // seq 1
    buffer.append("bbbb"); // seq 2
    buffer.append("cccc"); // seq 3; seq 1 must be evicted

    expect(buffer.retainedBytes).toBeLessThanOrEqual(8);
    expect(buffer.read(0)).toEqual({
      data: "bbbbcccc",
      bytes: 8,
      nextSequence: 3,
      truncatedBefore: true,
    });
    expect(buffer.read(1)).toEqual({
      data: "bbbbcccc",
      bytes: 8,
      nextSequence: 3,
      truncatedBefore: false,
    });
  });

  it("keeps a valid UTF-8 tail when one output event exceeds the byte budget", () => {
    const buffer = new TerminalOutputBuffer(7);
    buffer.append("old");
    buffer.append("a🙂b🙂c");

    const result = buffer.read(0);
    expect(result.nextSequence).toBe(2);
    expect(result.truncatedBefore).toBe(true);
    expect(result.bytes).toBeLessThanOrEqual(7);
    expect(Buffer.from(result.data, "utf8").toString("utf8")).toBe(result.data);
    expect(result.data.endsWith("🙂c")).toBe(true);
  });

  it("ignores empty output events without advancing the cursor", () => {
    const buffer = new TerminalOutputBuffer(16);
    expect(buffer.append("")).toBe(0);
    expect(buffer.read()).toEqual({
      data: "",
      bytes: 0,
      nextSequence: 0,
      truncatedBefore: false,
    });
  });
});
