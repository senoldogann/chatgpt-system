import { describe, expect, it } from "vitest";
import { NodePtyBackend } from "../src/terminal-pty-backend.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PTY smoke test timed out")), timeoutMs);
    timer.unref();
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

describe("real node-pty backend", () => {
  it("provides a real TTY with interactive input and resize", async () => {
    const backend = new NodePtyBackend();
    const handle = await backend.spawn({
      file: "/bin/sh",
      args: [
        "-c",
        "printf 'TTY:%s\\n' \"$([ -t 0 ] && echo yes || echo no)\"; printf 'SIZE1:'; stty size; printf 'READY\\n'; read value; printf 'VALUE:%s\\n' \"$value\"; printf 'SIZE2:'; stty size",
      ],
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TERM: "xterm-256color",
      },
      cols: 80,
      rows: 24,
    });

    let output = "";
    let wroteInput = false;
    const exited = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
      handle.onData((data) => {
        output += data;
        if (!wroteInput && output.includes("READY")) {
          wroteInput = true;
          handle.resize(100, 30);
          handle.write("hello\r");
        }
      });
      handle.onExit(resolve);
    });

    const result = await withTimeout(exited, 5_000);
    expect(result.exitCode).toBe(0);
    expect(output).toContain("TTY:yes");
    expect(output).toMatch(/SIZE1:\s*24\s+80/);
    expect(output).toContain("VALUE:hello");
    expect(output).toMatch(/SIZE2:\s*30\s+100/);
    expect(handle.cols).toBe(100);
    expect(handle.rows).toBe(30);
  });
});
