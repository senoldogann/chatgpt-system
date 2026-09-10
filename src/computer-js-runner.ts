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
  const workerSource = String.raw`
    const { parentPort, workerData } = require("node:worker_threads");
    const { createRequire } = require("node:module");
    const { randomBytes } = require("node:crypto");
    const path = require("node:path");

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
      pointerPosition: () => rpc("pointer_position", {}),
      listApps: () => rpc("list_apps", {}),
      activeWindow: () => rpc("active_window", {}),
      openApp: (input) => rpc("open_app", input),
      focusApp: (input) => rpc("focus_app", input),
      moveMouse: (input) => rpc("move_mouse", input),
      click: (input) => rpc("click", input),
      drag: (from, to, options = {}) => rpc("drag", { from, to, ...options }),
      scroll: (options) => rpc("scroll", options),
      typeText: (text, options = {}) => rpc("type_text", { text, ...options }),
      pressKey: (key, options = {}) => rpc("press_key", { key, ...options }),
      wait: (durationMs) => rpc("wait", { durationMs }),
      waitForFrontmost: (input) => rpc("wait_for_frontmost", input),
      waitForText: (text, options = {}) => rpc("wait_for_text", { text, ...options }),
      waitUntilChanged: (options) => rpc("wait_until_changed", options),
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
  let failed = false;

  const failClosed = (): void => {
    if (failed || completed) return;
    failed = true;
    process.exitCode = 1;
    void worker.terminate().catch(() => undefined);
  };

  worker.stdout?.pipe(process.stdout);
  worker.stderr?.pipe(process.stderr);

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
    completed = true;
    if (!sendToParent(parsed.data)) {
      completed = false;
      failClosed();
    }
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
    if (!completed) {
      sendToParent({ type: "worker_exit", exitCode: failed && exitCode === 0 ? 1 : exitCode });
    }
    if (!completed || exitCode !== 0 || failed) {
      process.exitCode = exitCode === 0 ? 1 : exitCode;
    }
    if (process.connected) process.disconnect();
  });
}
