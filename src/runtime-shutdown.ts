import type { ControlServerHandle } from "./control-server.js";
import type { RuntimeServices } from "./server.js";

export type RuntimeShutdownPhase = "computer" | "processes" | "browser" | "control" | "transport";

export async function closeRuntimeResources(input: {
  runtime: Pick<RuntimeServices, "computer" | "processSupervisor" | "browser">;
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

  await attempt("computer", () => input.runtime.computer.close());
  await attempt("processes", () => input.runtime.processSupervisor.close());
  await attempt("browser", async () => {
    await input.runtime.browser.close();
  });
  if (input.control) await attempt("control", () => input.control!.close());
  await attempt("transport", input.closeTransport);
}
