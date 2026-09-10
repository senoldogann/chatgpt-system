import { describe, expect, it } from "vitest";
import {
  ComputerError,
  isComputerErrorCode,
  normalizeComputerNativeError,
} from "../src/computer-errors.js";

describe("computer error normalization", () => {
  it("maps allowlisted native codes to fixed TypeScript-owned messages", () => {
    const error = normalizeComputerNativeError("COMPUTER_TIMEOUT");
    expect(error).toBeInstanceOf(ComputerError);
    expect(error).toMatchObject({
      code: "COMPUTER_TIMEOUT",
      message: "Computer operation timed out.",
    });
  });

  it("defines stable full-host JavaScript failure codes with fixed public messages", () => {
    expect(new ComputerError("COMPUTER_JS_DISABLED")).toMatchObject({
      code: "COMPUTER_JS_DISABLED",
      message: "Full-host computer JavaScript is disabled.",
    });
    expect(new ComputerError("COMPUTER_JS_FAILED")).toMatchObject({
      code: "COMPUTER_JS_FAILED",
      message: "Full-host computer JavaScript failed.",
    });
    expect(new ComputerError("COMPUTER_JS_TIMEOUT")).toMatchObject({
      code: "COMPUTER_JS_TIMEOUT",
      message: "Full-host computer JavaScript timed out.",
    });
    expect(isComputerErrorCode("COMPUTER_JS_DISABLED")).toBe(true);
    expect(isComputerErrorCode("COMPUTER_JS_FAILED")).toBe(true);
    expect(isComputerErrorCode("COMPUTER_JS_TIMEOUT")).toBe(true);
  });

  it("does not accept unknown native error codes as public errors", () => {
    expect(isComputerErrorCode("NATIVE_SECRET_STACK")).toBe(false);
    expect(() => normalizeComputerNativeError("NATIVE_SECRET_STACK")).toThrowError(/protocol/i);
  });

  it("never needs a native message to construct a public error", () => {
    const error = normalizeComputerNativeError("COMPUTER_ACTION_FAILED", { failedStepIndex: 2 });
    expect(error.message).toBe("Computer action failed.");
    expect(error.details).toEqual({ failedStepIndex: 2 });
  });
});
