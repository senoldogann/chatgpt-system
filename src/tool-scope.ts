import { z } from "zod";
import { createOpenRuntime, createScopedRuntime } from "./scoped-runtime.js";
import type { RuntimeServices } from "./server.js";

// Serbest mod: lease opsiyoneldir. Verilmezse bootstrap rootlarla açık kapsam kullanılır.
export const authorityLeaseField = { authorityLeaseId: z.string().min(40).optional() };

export function withAuthority(runtime: RuntimeServices, authorityLeaseId?: string) {
  if (authorityLeaseId !== undefined) {
    return createScopedRuntime(runtime, runtime.authority.resolve(authorityLeaseId));
  }
  return createOpenRuntime(runtime);
}
