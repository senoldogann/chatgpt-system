import type { ContinuityStore } from "./continuity-store.js";
import type { ControlServerHandle } from "./control-server.js";
import type { RuntimeServices } from "./server.js";

export type RuntimeShutdownPhase = "computer-js" | "computer" | "processes" | "browser" | "continuity" | "control" | "transport";

export async function closeRuntimeResources(input: {
  runtime: Pick<RuntimeServices, "computerJs" | "computer" | "processSupervisor" | "browser"> & {
    continuityStore?: Pick<ContinuityStore, "close">;
  };
  control?: ControlServerHandle;
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
  await attempt("processes", () => input.runtime.processSupervisor.close());
  await attempt("browser", async () => {
    await input.runtime.browser.close();
  });
  if (input.runtime.continuityStore) {
    await attempt("continuity", async () => {
      input.runtime.continuityStore!.close();
    });
  }
  if (input.control) await attempt("control", () => input.control!.close());
  await attempt("transport", input.closeTransport);
}
