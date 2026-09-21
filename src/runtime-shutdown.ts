import type { ContinuityStore } from "./continuity-store.js";
import type { SessionEventStore } from "./session-event-store.js";
import type { RuntimeServices } from "./server.js";

export type RuntimeShutdownPhase = "computer-js" | "computer" | "terminal-sessions" | "owner-shell" | "processes" | "browser" | "session-events" | "continuity" | "transport";

export async function closeRuntimeResources(input: {
  runtime: Pick<RuntimeServices, "computerJs" | "computer" | "terminalSessionSupervisor" | "ownerShellSupervisor" | "processSupervisor" | "browser"> & {
    sessionEventStore?: Pick<SessionEventStore, "close">;
    continuityStore?: Pick<ContinuityStore, "close">;
  };
  closeTransport: () => Promise<void>;
  reportError?: (phase: RuntimeShutdownPhase, error: unknown) => void;
}): Promise<void> {
  const attempt = async (phase: RuntimeShutdownPhase, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      input.reportError?.(phase, error);
    }
  };

  await attempt("computer-js", () => input.runtime.computerJs.close());
  await attempt("computer", () => input.runtime.computer.close());
  await attempt("terminal-sessions", () => input.runtime.terminalSessionSupervisor.close());
  await attempt("owner-shell", () => input.runtime.ownerShellSupervisor.close());
  // Persistent managed jobs intentionally survive a daemon restart; their metadata and redirected logs remain queryable.
  await attempt("processes", () => input.runtime.processSupervisor.close(true));
  await attempt("browser", async () => {
    await input.runtime.browser.close();
  });
  if (input.runtime.sessionEventStore) {
    await attempt("session-events", async () => {
      input.runtime.sessionEventStore!.close();
    });
  }
  if (input.runtime.continuityStore) {
    await attempt("continuity", async () => {
      input.runtime.continuityStore!.close();
    });
  }
  await attempt("transport", input.closeTransport);
}
