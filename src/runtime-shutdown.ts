import type { ControlServerHandle } from "./control-server.js";
import type { RuntimeServices } from "./server.js";

export type RuntimeShutdownPhase = "processes" | "control" | "transport";

export async function closeRuntimeResources(input: {
  runtime: Pick<RuntimeServices, "processSupervisor">;
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

  await attempt("processes", () => input.runtime.processSupervisor.close());
  if (input.control) await attempt("control", () => input.control!.close());
  await attempt("transport", input.closeTransport);
}
