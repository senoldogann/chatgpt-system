import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLogger } from "../src/audit.js";
import type { OwnerRuntimeConfig } from "../src/config.js";
import { PathPolicy } from "../src/policy.js";
import type { TerminalPtyBackend, TerminalPtyExit, TerminalPtyHandle, TerminalPtySpawnInput } from "../src/terminal-pty-backend.js";
import { TerminalSessionService } from "../src/terminal-session-service.js";
import { TerminalSessionSupervisor } from "../src/terminal-session-supervisor.js";

class FakePty implements TerminalPtyHandle {
  cols: number;
  rows: number;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: TerminalPtyExit) => void>();

  constructor(readonly pid: number, cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
  }

  write(): void {}
  resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
  kill(): void {}
  onData(listener: (data: string) => void) { this.dataListeners.add(listener); return { dispose: () => this.dataListeners.delete(listener) }; }
  onExit(listener: (event: TerminalPtyExit) => void) { this.exitListeners.add(listener); return { dispose: () => this.exitListeners.delete(listener) }; }
  emitData(data: string): void { for (const listener of this.dataListeners) listener(data); }
}

class FakeBackend implements TerminalPtyBackend {
  handle: FakePty | undefined;
  async spawn(input: TerminalPtySpawnInput): Promise<TerminalPtyHandle> {
    this.handle = new FakePty(98765, input.cols, input.rows);
    return this.handle;
  }
}

const cleanups: string[] = [];
const ownerConfig: OwnerRuntimeConfig = {
  enabled: true,
  shellPath: "/bin/sh",
  maxScriptBytes: 262_144,
  maxTerminalSessions: 4,
  maxTerminalOutputBytes: 1024,
  maxTerminalInputBytes: 1024,
};

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

describe("terminal session audit privacy", () => {
  it("records lifecycle metadata without PTY content, session ids, or native ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chatgpt-system-terminal-audit-"));
    cleanups.push(root);
    const auditPath = path.join(root, "audit.jsonl");
    const backend = new FakeBackend();
    const supervisor = new TerminalSessionSupervisor({
      backend,
      maxSessions: 4,
      maxOutputBytes: 1024,
      maxInputBytes: 1024,
      processStopGraceMs: 5,
      signalProcess: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); },
    });
    const service = new TerminalSessionService(
      new PathPolicy([root]),
      new AuditLogger(auditPath),
      supervisor,
      ownerConfig,
      true,
    );

    const inputMarker = "PTY-INPUT-SECRET-MARKER";
    const outputMarker = "PTY-OUTPUT-SECRET-MARKER";
    const opened = await service.open({ cwd: root, cols: 90, rows: 25 });
    backend.handle!.emitData(outputMarker);
    await service.read(opened.sessionId);
    await service.write(opened.sessionId, inputMarker);
    await service.resize(opened.sessionId, 100, 40);
    await service.close(opened.sessionId);

    const audit = await readFile(auditPath, "utf8");
    expect(audit).toContain("terminal.session.open");
    expect(audit).toContain("terminal.session.read");
    expect(audit).toContain("terminal.session.write");
    expect(audit).toContain("terminal.session.resize");
    expect(audit).toContain("terminal.session.close");
    expect(audit).not.toContain(inputMarker);
    expect(audit).not.toContain(outputMarker);
    expect(audit).not.toContain(opened.sessionId);
    expect(audit).not.toContain("98765");

    const events = audit.trim().split("\n").map((line) => JSON.parse(line) as {
      action: string;
      metadata?: Record<string, unknown>;
    });
    expect(events.find((event) => event.action === "terminal.session.write")?.metadata).toMatchObject({
      inputByteCount: Buffer.byteLength(inputMarker),
    });
    expect(events.find((event) => event.action === "terminal.session.read")?.metadata).toMatchObject({
      outputByteCount: Buffer.byteLength(outputMarker),
      truncated: false,
    });
  });
});
