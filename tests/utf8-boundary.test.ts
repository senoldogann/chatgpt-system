import { describe, expect, it } from "vitest";
import { completeUtf8Span } from "../src/utf8-boundary.js";

function span(bytes: number[]) {
  return completeUtf8Span(Uint8Array.from(bytes));
}

describe("completeUtf8Span", () => {
  it("keeps complete ASCII and multi-byte text intact", () => {
    const text = Buffer.from("aé€😀");
    expect(completeUtf8Span(text)).toEqual({ start: 0, end: text.byteLength });
  });

  it("withholds an incomplete trailing sequence of every length", () => {
    expect(span([0x61, 0xc3])).toEqual({ start: 0, end: 1 });
    expect(span([0x61, 0xe2, 0x82])).toEqual({ start: 0, end: 1 });
    expect(span([0x61, 0xf0, 0x9f, 0x98])).toEqual({ start: 0, end: 1 });
  });

  it("skips continuation bytes left at a truncated start", () => {
    expect(span([0x98, 0x80, 0x61])).toEqual({ start: 2, end: 3 });
  });

  it("handles empty and continuation-only input", () => {
    expect(span([])).toEqual({ start: 0, end: 0 });
    expect(span([0x80, 0x80])).toEqual({ start: 2, end: 2 });
  });
});
