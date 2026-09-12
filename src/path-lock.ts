import { canonicalizePath } from "./policy.js";

const queues = new Map<string, Promise<void>>();

function withCanonicalLock<Result>(key: string, operation: () => Promise<Result>): Promise<Result> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const settled = run.then(() => undefined, () => undefined);
  queues.set(key, settled);
  return run.finally(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
}

export async function withPathLock<Result>(target: string, operation: () => Promise<Result>): Promise<Result> {
  return withCanonicalLock(await canonicalizePath(target), operation);
}

export async function withPathLocks<Result>(targets: string[], operation: () => Promise<Result>): Promise<Result> {
  const canonical = await Promise.all(targets.map((target) => canonicalizePath(target)));
  // Sorted acquisition keeps overlapping multi-file transactions deadlock-free.
  const keys = [...new Set(canonical)].sort();
  const acquire = (index: number): Promise<Result> =>
    index >= keys.length ? operation() : withCanonicalLock(keys[index]!, () => acquire(index + 1));
  return acquire(0);
}
