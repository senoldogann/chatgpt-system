import { describe, expect, it } from "vitest";
import {
  CommandNotAllowedError,
  LspUnavailableError,
  ProjectExecDisabledError,
  ProjectExecTimeoutError,
  RecoveryRequiredError,
  SandboxUnavailableError,
  TaskStateNotFoundError,
  VerificationRequiredError,
  WorktreeDirtyError,
  WorktreeNotFoundError,
  errorPayload,
} from "../src/errors.js";

describe("coding harness stable error contract", () => {
  it.each([
    [new LspUnavailableError("unsupported-language"), "LSP_UNAVAILABLE", false],
    [new TaskStateNotFoundError(), "TASK_STATE_NOT_FOUND", false],
    [new RecoveryRequiredError(), "RECOVERY_REQUIRED", false],
    [new WorktreeNotFoundError(), "WORKTREE_NOT_FOUND", false],
    [new WorktreeDirtyError(), "WORKTREE_DIRTY", false],
    [new VerificationRequiredError("STALE"), "VERIFICATION_REQUIRED", true],
    [new ProjectExecDisabledError(), "PROJECT_EXEC_DISABLED", false],
    [new CommandNotAllowedError("sh", ["node"]), "COMMAND_NOT_ALLOWED", false],
    [new SandboxUnavailableError("docker_unavailable"), "SANDBOX_UNAVAILABLE", true],
    [new ProjectExecTimeoutError(1000), "COMMAND_TIMEOUT", true],
  ] as const)("exposes %s with explicit retryability", (error, code, retryable) => {
    const payload = errorPayload(error);
    expect(payload.error).toBe(code);
    expect(payload.details).toMatchObject({ retryable });
  });

  it("keeps verification status machine-actionable without embedding it in the error code", () => {
    expect(errorPayload(new VerificationRequiredError("UNAVAILABLE"))).toMatchObject({
      error: "VERIFICATION_REQUIRED",
      details: { overallStatus: "UNAVAILABLE", retryable: true },
    });
  });
});
