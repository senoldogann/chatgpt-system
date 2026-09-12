import { describe, expect, it, vi } from "vitest";
import { NodePtyBackend } from "../src/terminal-pty-backend.js";

describe("NodePtyBackend", () => {
  it("loads node-pty lazily and maps the native handle without exposing backend-specific APIs", async () => {
    const onData = vi.fn(() => ({ dispose: vi.fn() }));
    const onExit = vi.fn(() => ({ dispose: vi.fn() }));
    const write = vi.fn();
    const resize = vi.fn();
    const kill = vi.fn();
    const fakeSpawn = vi.fn(() => ({
      pid: 4242,
      cols: 120,
      rows: 30,
      write,
      resize,
      kill,
      onData,
      onExit,
    }));
    const importer = vi.fn(async () => ({ spawn: fakeSpawn }));
    const backend = new NodePtyBackend(importer);

    expect(importer).not.toHaveBeenCalled();
    const handle = await backend.spawn({
      file: "/bin/zsh",
      args: ["-l"],
      cwd: "/tmp",
      env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
      cols: 120,
      rows: 30,
    });

    expect(importer).toHaveBeenCalledOnce();
    expect(fakeSpawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-l"],
      expect.objectContaining({
        cwd: "/tmp",
        env: { PATH: "/usr/bin:/bin", TERM: "xterm-256color" },
        cols: 120,
        rows: 30,
        name: "xterm-256color",
      }),
    );
    expect(handle.pid).toBe(4242);
    expect(handle.cols).toBe(120);
    expect(handle.rows).toBe(30);

    handle.write("echo hello\r");
    handle.resize(100, 40);
    handle.kill("SIGTERM");
    const dataDisposable = handle.onData(() => undefined);
    const exitDisposable = handle.onExit(() => undefined);

    expect(write).toHaveBeenCalledWith("echo hello\r");
    expect(resize).toHaveBeenCalledWith(100, 40);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(onData).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledOnce();
    expect(dataDisposable).toHaveProperty("dispose");
    expect(exitDisposable).toHaveProperty("dispose");
  });

  it("caches the loaded node-pty module across PTY spawns", async () => {
    const fakeSpawn = vi.fn(() => ({
      pid: 4242,
      cols: 80,
      rows: 24,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    }));
    const importer = vi.fn(async () => ({ spawn: fakeSpawn }));
    const backend = new NodePtyBackend(importer);
    const input = {
      file: "/bin/zsh",
      args: ["-l"],
      cwd: "/tmp",
      env: { PATH: "/usr/bin:/bin" },
      cols: 80,
      rows: 24,
    };

    await backend.spawn(input);
    await backend.spawn(input);

    expect(importer).toHaveBeenCalledOnce();
    expect(fakeSpawn).toHaveBeenCalledTimes(2);
  });
});
