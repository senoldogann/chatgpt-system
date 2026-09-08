import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  MAX_LOG_BYTES,
  appendBoundedLog,
  parseRunnerArgs,
  readControlPlaneKey,
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
    ])).toEqual({
      tunnelClientPath: "/opt/homebrew/bin/tunnel-client",
      profile: "chatgpt-system",
      logDir: "/tmp/chatgpt-system-logs",
    });
  });

  it("reads the fixed Keychain item without placing a secret in argv", () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const value = readControlPlaneKey({
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0, stdout: "sentinel-secret\n", stderr: "" };
      },
    });

    expect(value).toBe("sentinel-secret");
    expect(calls).toEqual([{
      command: "/usr/bin/security",
      args: ["find-generic-password", "-w", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE],
    }]);
    expect(JSON.stringify(calls)).not.toContain("sentinel-secret");
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
      ],
      environment: { PATH: "/usr/bin:/bin" },
      readKey: () => "sentinel-secret",
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
        env: expect.objectContaining({ CONTROL_PLANE_API_KEY: "sentinel-secret" }),
      },
    });
    expect(JSON.stringify(seen[0]?.args)).not.toContain("sentinel-secret");

    const logs = `${await readFile(path.join(base, "stdout.log"), "utf8")}${await readFile(path.join(base, "stderr.log"), "utf8")}`;
    expect(logs).toContain("tunnel-ready");
    expect(logs).not.toContain("sentinel-secret");
  });
});
