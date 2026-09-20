import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  KEYCHAIN_SERVICE_TYPESAFE,
  MAX_LOG_BYTES,
  appendBoundedLog,
  parseRunnerArgs,
  readControlPlaneKey,
  readTypesafeApiKey,
  runDailyDriver,
} from "../scripts/daily-driver-runner.mjs";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("daily-driver tunnel runner", () => {
  it("accepts only absolute tunnel-client and log paths", () => {
    expect(() => parseRunnerArgs([
      "--tunnel-client", "tunnel-client",
      "--profile", "chatgpt-system",
      "--log-dir", "/tmp/logs",
    ])).toThrow(/absolute/i);

    expect(parseRunnerArgs([
      "--tunnel-client", "/opt/homebrew/bin/tunnel-client",
      "--profile", "chatgpt-system",
      "--log-dir", "/tmp/chatgpt-system-logs",
      "--keychain-helper", "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
    ])).toEqual({
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "chatgpt-system",
      logDir: "/tmp/chatgpt-system-logs",
      keychainHelperPath: "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
    });
  });

  it("reads the fixed Keychain item through the dedicated helper without placing a secret in argv", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    const value = readControlPlaneKey({
      helperPath,
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0, stdout: "sentinel-secret\n", stderr: "ignored-detail" };
      },
    });

    expect(value).toBe("sentinel-secret");
    expect(calls).toEqual([{
      command: helperPath,
      args: ["read", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE],
    }]);
    expect(calls[0]?.command).not.toBe("/usr/bin/security");
    expect(JSON.stringify(calls)).not.toContain("sentinel-secret");
  });

  it("does not expose helper stderr when a Keychain read fails", () => {
    expect(() => readControlPlaneKey({
      helperPath: "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
      spawnSync: () => ({ status: 1, stdout: "", stderr: "sensitive-keychain-detail" }),
    })).toThrow("Unable to read the daily-driver tunnel credential from macOS Keychain.");
  });

  it("reads the optional TypeSafe Keychain item through the dedicated helper without placing a secret in argv", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    const value = readTypesafeApiKey({
      helperPath,
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0, stdout: "typesafe-sentinel-secret\n", stderr: "ignored-detail" };
      },
    });

    expect(value).toBe("typesafe-sentinel-secret");
    expect(calls).toEqual([{
      command: helperPath,
      args: ["read", KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE_TYPESAFE],
    }]);
    expect(JSON.stringify(calls)).not.toContain("typesafe-sentinel-secret");
  });

  it("returns null when the TypeSafe Keychain item is absent or helper fails without throwing", () => {
    const helperPath = "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper";
    const missing = readTypesafeApiKey({
      helperPath,
      spawnSync: () => ({ status: 44, stdout: "", stderr: "not found" }),
    });
    expect(missing).toBeNull();

    const empty = readTypesafeApiKey({
      helperPath,
      spawnSync: () => ({ status: 0, stdout: "   \n", stderr: "" }),
    });
    expect(empty).toBeNull();

    const errored = readTypesafeApiKey({
      helperPath,
      spawnSync: () => ({ error: new Error("spawn failed"), status: null, stdout: "", stderr: "" }),
    });
    expect(errored).toBeNull();
  });

  it("rejects non-absolute helper path for readTypesafeApiKey", () => {
    expect(() => readTypesafeApiKey({ helperPath: "relative/helper" })).toThrow(/absolute/i);
  });

  it("keeps the newest tail when a single chunk exceeds the bound", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-log-"));
    cleanups.push(base);
    const file = path.join(base, "stdout.log");

    await appendBoundedLog(file, Buffer.from("0123456789ABCDEFGHIJ"), 10);

    expect((await stat(file)).size).toBe(10);
    expect(await readFile(file, "utf8")).toBe("ABCDEFGHIJ");
  });

  it("appends a long chunk stream within the append budget without rewriting the tail", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-log-"));
    cleanups.push(base);
    const file = path.join(base, "stdout.log");
    await appendBoundedLog(file, Buffer.alloc(MAX_LOG_BYTES, "a"));

    const startedAt = performance.now();
    for (let index = 0; index < 256; index += 1) {
      await appendBoundedLog(file, Buffer.alloc(4096, "b"));
    }
    const elapsedMs = performance.now() - startedAt;

    // Regression guard for the O(log) rewrite-per-chunk implementation: appending
    // 256 x 4 KiB chunks must not re-read and rewrite the whole retained log.
    expect(elapsedMs).toBeLessThan(250);
    expect((await stat(file)).size).toBeLessThanOrEqual(MAX_LOG_BYTES);
  }, 20_000);

  it("surfaces append failures instead of silently dropping log output", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-runner-"));
    cleanups.push(base);

    class FakeChild extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill() { return true; }
    }

    const child = new FakeChild();
    const exitCode = await runDailyDriver({
      argv: [
        "--tunnel-client", "/opt/homebrew/bin/tunnel-client",
        "--profile", "chatgpt-system",
        "--log-dir", base,
        "--keychain-helper", "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
      ],
      environment: { PATH: "/usr/bin:/bin" },
      readKey: () => "sentinel-secret",
      readTypesafeKey: () => null,
      spawnProcess: ((command: string, args: string[], options: Record<string, unknown>) => {
        void command; void args; void options;
        queueMicrotask(() => {
          child.stdout.write("tunnel-ready\n");
          child.stdout.end();
          child.stderr.end("");
          child.emit("close", 0, null);
        });
        return child as never;
      }) as never,
      appendLog: async () => {
        throw new Error("simulated disk failure");
      },
      installSignalHandlers: false,
    }).then(
      () => 0,
      (error: unknown) => {
        expect((error as Error).message).toContain("simulated disk failure");
        return 1;
      },
    );

    expect(exitCode).toBe(1);
  });

  it("keeps queued chunks ordered and bounded while the child streams rapidly", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-runner-"));
    cleanups.push(base);

    class FakeChild extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill() { return true; }
    }

    const child = new FakeChild();
    const exitCode = await runDailyDriver({
      argv: [
        "--tunnel-client", "/opt/homebrew/bin/tunnel-client",
        "--profile", "chatgpt-system",
        "--log-dir", base,
        "--keychain-helper", "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
      ],
      environment: { PATH: "/usr/bin:/bin" },
      readKey: () => "sentinel-secret",
      readTypesafeKey: () => null,
      spawnProcess: ((command: string, args: string[], options: Record<string, unknown>) => {
        void command; void args; void options;
        queueMicrotask(() => {
          for (let index = 0; index < 50; index += 1) child.stdout.write(`SEQ-${String(index).padStart(2, "0")}\n`);
          child.stdout.end();
          child.stderr.end("");
          child.emit("close", 0, null);
        });
        return child as never;
      }) as never,
      installSignalHandlers: false,
    });

    expect(exitCode).toBe(0);
    const log = await readFile(path.join(base, "stdout.log"), "utf8");
    let cursor = -1;
    for (let index = 0; index < 50; index += 1) {
      const found = log.indexOf(`SEQ-${String(index).padStart(2, "0")}`);
      expect(found).toBeGreaterThan(cursor);
      cursor = found;
    }
  });

  it("retains only the newest bounded log tail", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-log-"));
    cleanups.push(base);
    const file = path.join(base, "stdout.log");
    const older = Buffer.alloc(MAX_LOG_BYTES, "a");
    const newer = Buffer.from("newest-tail");

    await appendBoundedLog(file, older);
    await appendBoundedLog(file, newer);

    expect((await stat(file)).size).toBeLessThanOrEqual(MAX_LOG_BYTES);
    expect((await readFile(file)).subarray(-newer.length).toString("utf8")).toBe("newest-tail");
  });

  it("passes the key only in the child environment and never writes it to logs", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-runner-"));
    cleanups.push(base);
    const seen: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];

    class FakeChild extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill() { return true; }
    }

    const child = new FakeChild();
    const spawnProcess = (command: string, args: string[], options: Record<string, unknown>) => {
      seen.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.end("tunnel-ready\n");
        child.stderr.end("diagnostic\n");
        child.emit("close", 0, null);
      });
      return child as never;
    };

    const exitCode = await runDailyDriver({
      argv: [
        "--tunnel-client", "/opt/homebrew/bin/tunnel-client",
        "--profile", "chatgpt-system",
        "--log-dir", base,
        "--keychain-helper", "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
      ],
      environment: { PATH: "/usr/bin:/bin" },
      readKey: () => "sentinel-secret",
      readTypesafeKey: () => "typesafe-keychain-secret",
      spawnProcess: spawnProcess as never,
      installSignalHandlers: false,
    });

    expect(exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      command: "/opt/homebrew/bin/tunnel-client",
      args: ["run", "--profile", "chatgpt-system"],
      options: {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: expect.objectContaining({
          CONTROL_PLANE_API_KEY: "sentinel-secret",
          TYPESAFE_API_KEY: "typesafe-keychain-secret",
        }),
      },
    });
    expect(JSON.stringify(seen[0]?.args)).not.toContain("sentinel-secret");
    expect(JSON.stringify(seen[0]?.args)).not.toContain("typesafe-keychain-secret");

    const logs = `${await readFile(path.join(base, "stdout.log"), "utf8")}${await readFile(path.join(base, "stderr.log"), "utf8")}`;
    expect(logs).toContain("tunnel-ready");
    expect(logs).not.toContain("sentinel-secret");
    expect(logs).not.toContain("typesafe-keychain-secret");
  });

  it("omits TYPESAFE_API_KEY when no TypeSafe credential is in Keychain or environment", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "chatgpt-system-daily-runner-"));
    cleanups.push(base);
    const seen: Array<{ command: string; args: string[]; options: { env?: Record<string, string> } }> = [];

    class FakeChild extends EventEmitter {
      stdout = new PassThrough();
      stderr = new PassThrough();
      kill() { return true; }
    }

    const child = new FakeChild();
    const spawnProcess = (command: string, args: string[], options: { env?: Record<string, string> }) => {
      seen.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.end("tunnel-ready\n");
        child.stderr.end("");
        child.emit("close", 0, null);
      });
      return child as never;
    };

    const exitCode = await runDailyDriver({
      argv: [
        "--tunnel-client", "/opt/homebrew/bin/tunnel-client",
        "--profile", "chatgpt-system",
        "--log-dir", base,
        "--keychain-helper", "/Users/test/.chatgpt-system/bin/chatgpt-system-keychain-helper",
      ],
      environment: { PATH: "/usr/bin:/bin" },
      readKey: () => "sentinel-secret",
      readTypesafeKey: () => null,
      spawnProcess: spawnProcess as never,
      installSignalHandlers: false,
    });

    expect(exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.options.env).toBeDefined();
    expect(seen[0]?.options.env).not.toHaveProperty("TYPESAFE_API_KEY");
  });
});
