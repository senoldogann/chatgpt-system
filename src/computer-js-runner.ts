import { randomBytes as randomBoundaryBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { Worker } from "node:worker_threads";
import {
  runnerRpcResponseSchema,
  workerToRunnerMessageSchema,
  type RunnerMessage,
} from "./computer-js-protocol.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}
const source = Buffer.concat(chunks).toString("utf8");

function forwardUntilBoundary(sourceStream: Readable | null, destination: Writable, boundaryText: string): Promise<void> {
  if (!sourceStream) return Promise.reject(new Error("Worker output stream is unavailable."));
  const boundary = Buffer.from(boundaryText, "utf8");
  return new Promise<void>((resolve, reject) => {
    let tail = Buffer.alloc(0);
    let pendingWrites = 0;
    let boundarySeen = false;
    let settled = false;

    const fail = (error = new Error("Worker output boundary is invalid.")): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const maybeResolve = (): void => {
      if (settled || !boundarySeen || pendingWrites !== 0) return;
      settled = true;
      resolve();
    };
    const write = (buffer: Buffer): void => {
      if (buffer.length === 0 || settled) return;
      pendingWrites += 1;
      try {
        const accepted = destination.write(buffer, (error: Error | null | undefined) => {
          pendingWrites -= 1;
          if (error) {
            fail(error);
            return;
          }
          maybeResolve();
        });
        if (!accepted) {
          sourceStream.pause();
          destination.once("drain", () => {
            if (!settled) sourceStream.resume();
          });
        }
      } catch (error) {
        pendingWrites -= 1;
        fail(error instanceof Error ? error : new Error("Worker output forwarding failed."));
      }
    };

    sourceStream.on("data", (raw: Buffer | string) => {
      if (settled || boundarySeen) return;
      const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const data = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
      const boundaryIndex = data.indexOf(boundary);
      if (boundaryIndex >= 0) {
        write(data.subarray(0, boundaryIndex));
        const trailing = data.subarray(boundaryIndex + boundary.length);
        tail = Buffer.alloc(0);
        boundarySeen = true;
        if (trailing.length !== 0) {
          fail();
          return;
        }
        maybeResolve();
        return;
      }

      const keep = Math.min(boundary.length - 1, data.length);
      const splitAt = data.length - keep;
      write(data.subarray(0, splitAt));
      tail = Buffer.from(data.subarray(splitAt));
    });
    sourceStream.once("end", () => {
      if (!boundarySeen) fail();
    });
    sourceStream.once("error", (error) => fail(error));
  });
}

function sendToParent(message: RunnerMessage): boolean {
  if (typeof process.send !== "function" || !process.connected) return false;
  try {
    process.send(message);
    return true;
  } catch {
    return false;
  }
}

if (typeof process.send !== "function") {
  process.exitCode = 1;
} else {
  const boundaryToken = randomBoundaryBytes(24).toString("base64url");
  const stdoutBoundary = `\u0000chatgpt-system-stdout-${boundaryToken}\u0000`;
  const stderrBoundary = `\u0000chatgpt-system-stderr-${boundaryToken}\u0000`;
  const workerSource = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    const { createRequire } = require("node:module");
    const { randomBytes } = require("node:crypto");
    const path = require("node:path");
    const stdoutBoundary = ${JSON.stringify(stdoutBoundary)};
    const stderrBoundary = ${JSON.stringify(stderrBoundary)};

    if (!parentPort) process.exit(1);

    const pending = new Map();
    parentPort.on("message", (message) => {
      if (!message || message.type !== "rpc_result" || typeof message.id !== "string") return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok === true) waiter.resolve(message.result);
      else {
        const error = new Error(message.error?.message ?? "Computer RPC failed.");
        if (typeof message.error?.code === "string") error.code = message.error.code;
        waiter.reject(error);
      }
    });

    function rpc(method, params) {
      const id = randomBytes(24).toString("base64url");
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        parentPort.postMessage({ type: "rpc", id, method, params });
      });
    }

    const computer = Object.freeze({
      observe: (options = {}) => rpc("observe", options),
      screenshot: (options = {}) => rpc("screenshot", options),
      resolve: (target, options) => rpc("resolve", { target, ...(options ?? {}) }),
      resolveMany: (targets, options) => rpc("resolve_many", { targets, ...(options ?? {}) }),
      exists: (target, options) => rpc("exists", { target, ...(options ?? {}) }),
      refreshObservation: () => rpc("refresh_observation", {}),
      pointerPosition: () => rpc("pointer_position", {}),
      listApps: () => rpc("list_apps", {}),
      activeWindow: () => rpc("active_window", {}),
      openApp: (input) => rpc("open_app", input),
      focusApp: (input) => rpc("focus_app", input),
      moveMouse: (input) => rpc("move_mouse", input),
      click: (input) => rpc("click", input),
      drag: (input) => rpc("drag", input),
      scroll: (input) => rpc("scroll", input),
      typeText: (input) => rpc("type_text", input),
      pressKey: (input) => rpc("press_key", input),
      wait: (durationMs) => rpc("wait", { durationMs }),
      waitForFrontmost: (input) => rpc("wait_for_frontmost", input),
      waitForText: (input) => rpc("wait_for_text", input),
      waitUntilChanged: (input) => rpc("wait_until_changed", input),
      releaseInputs: () => rpc("release_inputs", {}),
    });

    const virtualFile = path.join(process.cwd(), "__chatgpt_system_run_js__.cjs");
    const userRequire = createRequire(virtualFile);
    const userModule = { exports: {} };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    (async () => {
      try {
        const execute = new AsyncFunction(
          "computer",
          "require",
          "module",
          "exports",
          "__filename",
          "__dirname",
          workerData.source,
        );
        const result = await execute(
          computer,
          userRequire,
          userModule,
          userModule.exports,
          virtualFile,
          process.cwd(),
        );
        const resultJson = result === undefined ? undefined : JSON.stringify(result);
        if (result !== undefined && resultJson === undefined) throw new Error("Result is not JSON serializable.");
        process.stdout.write(stdoutBoundary);
        process.stderr.write(stderrBoundary);
        parentPort.postMessage({
          type: "complete",
          ...(resultJson !== undefined ? { resultJson } : {}),
        });
        parentPort.close();
      } catch {
        process.exitCode = 1;
        parentPort.close();
      }
    })();
  `;

  const worker = new Worker(workerSource, {
    eval: true,
    workerData: { source },
    stdout: true,
    stderr: true,
  });
  const pendingRpcIds = new Set<string>();
  let completed = false;
  let completionPending = false;
  let failed = false;
  let workerExitObserved = false;
  let workerExitCode = 0;

  const failClosed = (): void => {
    if (failed || completed) return;
    failed = true;
    process.exitCode = 1;
    void worker.terminate().catch(() => undefined);
  };

  const stdoutForwarded = forwardUntilBoundary(worker.stdout, process.stdout, stdoutBoundary);
  const stderrForwarded = forwardUntilBoundary(worker.stderr, process.stderr, stderrBoundary);
  void Promise.all([stdoutForwarded, stderrForwarded]).catch(() => failClosed());

  worker.on("message", (message: unknown) => {
    if (failed || completed) return;
    const parsed = workerToRunnerMessageSchema.safeParse(message);
    if (!parsed.success) {
      failClosed();
      return;
    }

    if (parsed.data.type === "rpc") {
      if (pendingRpcIds.has(parsed.data.id)) {
        failClosed();
        return;
      }
      pendingRpcIds.add(parsed.data.id);
      if (!sendToParent(parsed.data)) failClosed();
      return;
    }

    if (pendingRpcIds.size !== 0) {
      failClosed();
      return;
    }
    completionPending = true;
    void Promise.all([stdoutForwarded, stderrForwarded]).then(() => {
      if (failed || completed) return;
      if (workerExitObserved && workerExitCode !== 0) {
        failClosed();
        return;
      }
      completed = true;
      completionPending = false;
      if (!sendToParent(parsed.data)) {
        completed = false;
        failClosed();
        return;
      }
      if (process.connected) process.disconnect();
    }, () => failClosed());
  });

  process.on("message", (message: unknown) => {
    if (failed || completed) return;
    const parsed = runnerRpcResponseSchema.safeParse(message);
    if (!parsed.success || !pendingRpcIds.has(parsed.data.id)) {
      failClosed();
      return;
    }
    pendingRpcIds.delete(parsed.data.id);
    worker.postMessage(parsed.data);
  });

  worker.once("error", () => {
    // The worker exit event below reports only a categorical exit code.
  });

  worker.once("exit", (exitCode) => {
    workerExitObserved = true;
    workerExitCode = exitCode;
    if (!completed && !completionPending) {
      sendToParent({ type: "worker_exit", exitCode: failed && exitCode === 0 ? 1 : exitCode });
    }
    if (!completed && !completionPending || exitCode !== 0 || failed) {
      process.exitCode = exitCode === 0 ? 1 : exitCode;
    }
    if (!completionPending && process.connected) process.disconnect();
  });
}
