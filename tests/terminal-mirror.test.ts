import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalMirror } from "../src/terminal/terminal-mirror.js";

const cleanups: string[] = [];

afterEach(async () => {
  for (const dir of cleanups.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function fixture(maxFileBytes: number, maxSessions: number): Promise<{ directory: string; mirror: TerminalMirror }> {
  const directory = await mkdtemp(path.join(tmpdir(), "cos-terminal-mirror-"));
  cleanups.push(directory);
  return { directory, mirror: new TerminalMirror(directory, { maxFileBytes, maxSessions }) };
}

describe("terminal mirror", () => {
  it("oturum metasini ve kuyrugu yazar, en yeni oturumu basa alir", async () => {
    const { mirror } = await fixture(8_192, 8);
    mirror.start("session-a", "/tmp/a");
    mirror.append("session-a", "ilk\n");
    mirror.start("session-b", "/tmp/b");
    mirror.append("session-b", "ikinci\n");
    await mirror.flush();

    const sessions = await mirror.list();
    expect(sessions.map((session) => session.sessionId)).toEqual(["session-b", "session-a"]);
    expect(sessions[0]).toMatchObject({ cwd: "/tmp/b", state: "running" });
    expect(sessions[0].tail).toBe("ikinci");
    expect(sessions[1].tail).toBe("ilk");
  });

  it("ayna dizinini yalnizca sahibine acik olusturur", async () => {
    const { directory } = await fixture(8_192, 8);
    const streams = path.join(directory, "streams");
    const mirror = new TerminalMirror(streams, { maxFileBytes: 8_192, maxSessions: 8 });
    mirror.start("session-a", "/tmp/a");
    await mirror.flush();
    expect((await stat(streams)).mode & 0o777).toBe(0o700);
  });

  it("biten oturumun durumunu gunceller", async () => {
    const { mirror } = await fixture(8_192, 8);
    mirror.start("session-a", "/tmp/a");
    mirror.append("session-a", "cikti\n");
    mirror.finish("session-a", "exited", 0);
    await mirror.flush();

    const sessions = await mirror.list();
    expect(sessions[0]).toMatchObject({ sessionId: "session-a", state: "exited" });
  });

  it("dosya tavanini asinca kuyrugu korur", async () => {
    const { directory, mirror } = await fixture(100, 8);
    mirror.start("session-a", "/tmp/a");
    mirror.append("session-a", "x".repeat(150));
    mirror.append("session-a", "SON");
    await mirror.flush();

    const raw = await readFile(path.join(directory, "session-a.log"), "utf8");
    expect(raw.length).toBeLessThanOrEqual(100);
    expect(raw.endsWith("SON")).toBe(true);
    const sessions = await mirror.list();
    expect(sessions[0].tail.endsWith("SON")).toBe(true);
  });

  it("en eski oturumlari budar", async () => {
    const { mirror } = await fixture(8_192, 2);
    mirror.start("session-1", "/tmp/1");
    mirror.append("session-1", "bir\n");
    await mirror.flush();
    mirror.start("session-2", "/tmp/2");
    mirror.append("session-2", "iki\n");
    await mirror.flush();
    mirror.start("session-3", "/tmp/3");
    mirror.append("session-3", "uc\n");
    await mirror.flush();

    const sessions = await mirror.list();
    expect(sessions.map((session) => session.sessionId).sort()).toEqual(["session-2", "session-3"]);
  });

  it("gecersiz oturum kimligini yok sayar", async () => {
    const { mirror } = await fixture(8_192, 8);
    mirror.start("../evil", "/tmp/x");
    mirror.append("a b", "veri");
    await mirror.flush();
    expect(await mirror.list()).toEqual([]);
  });
});
