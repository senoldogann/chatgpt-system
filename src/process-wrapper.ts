import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import path from "node:path";

interface Manifest {
  version: 1;
  command: string;
  args: string[];
  cwd: string;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
  controlPath: string;
  controlToken: string;
  cursorPath: string;
  maxLogBytes: number;
}

function atomicallyWrite(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

function appendBounded(filePath: string, chunk: Buffer, maxBytes: number): void {
  appendFileSync(filePath, chunk, { mode: 0o600 });
  const size = statSync(filePath).size;
  if (size <= maxBytes) return;
  const content = readFileSync(filePath);
  const retained = content.subarray(Math.max(0, content.byteLength - maxBytes));
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, retained, { mode: 0o600 });
  renameSync(temporary, filePath);
}

function loadManifest(filePath: string): Manifest {
  const value = JSON.parse(readFileSync(filePath, "utf8")) as Partial<Manifest>;
  if (value.version !== 1 || typeof value.command !== "string" || !Array.isArray(value.args)
    || typeof value.cwd !== "string" || typeof value.stdoutPath !== "string"
    || typeof value.stderrPath !== "string" || typeof value.resultPath !== "string"
    || typeof value.controlPath !== "string" || typeof value.controlToken !== "string"
    || typeof value.cursorPath !== "string" || typeof value.maxLogBytes !== "number" || !Number.isSafeInteger(value.maxLogBytes) || value.maxLogBytes < 1) {
    throw new Error("invalid process manifest");
  }
  return {
    version: 1,
    command: value.command,
    args: value.args.filter((item): item is string => typeof item === "string"),
    cwd: value.cwd,
    stdoutPath: value.stdoutPath,
    stderrPath: value.stderrPath,
    resultPath: value.resultPath,
    controlPath: value.controlPath,
    controlToken: value.controlToken,
    cursorPath: value.cursorPath,
    maxLogBytes: value.maxLogBytes,
  };
}

async function main(): Promise<void> {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error("missing process manifest");
  const manifest = loadManifest(manifestPath);
  mkdirSync(path.dirname(manifest.stdoutPath), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(manifest.resultPath), { recursive: true, mode: 0o700 });
  if (!existsSync(manifest.stdoutPath)) writeFileSync(manifest.stdoutPath, "", { encoding: "utf8", mode: 0o600 });
  if (!existsSync(manifest.stderrPath)) writeFileSync(manifest.stderrPath, "", { encoding: "utf8", mode: 0o600 });
  let offsets = { stdout: 0, stderr: 0 };
  try {
    const previous = JSON.parse(readFileSync(manifest.cursorPath, "utf8")) as Partial<typeof offsets>;
    if (Number.isSafeInteger(previous.stdout) && Number.isSafeInteger(previous.stderr)) offsets = { stdout: previous.stdout!, stderr: previous.stderr! };
  } catch { /* first run or incomplete cursor record */ }
  atomicallyWrite(manifest.cursorPath, offsets);

  let child;
  try {
    child = spawn(manifest.command, manifest.args, {
      cwd: manifest.cwd,
      shell: false,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    atomicallyWrite(manifest.resultPath, {
      version: 1,
      started: false,
      finishedAt: new Date().toISOString(),
      errorCode: "PROCESS_START_FAILED",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 127;
    return;
  }

  let finalized = false;
  const finalize = (exitCode: number | null, signal: NodeJS.Signals | null) => {
    if (finalized) return;
    finalized = true;
    atomicallyWrite(manifest.resultPath, {
      version: 1,
      started: true,
      finishedAt: new Date().toISOString(),
      exitCode,
      signal,
    });
  };

  const forwardSignal = (signal: NodeJS.Signals) => {
    try { child.kill(signal); } catch { /* the close event remains authoritative */ }
  };
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  process.once("SIGINT", () => forwardSignal("SIGINT"));

  try { unlinkSync(manifest.controlPath); } catch { /* stale control path is harmless */ }
  const controlServer = createServer((socket: Socket) => {
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      if (!input.includes("\n")) return;
      try {
        const request = JSON.parse(input.split("\n", 1)[0]!) as { token?: string; operation?: string };
        if (request.token !== manifest.controlToken || request.operation !== "stop") {
          socket.end(`${JSON.stringify({ ok: false, code: "PROCESS_CONTROL_INVALID" })}\n`);
          return;
        }
        forwardSignal("SIGTERM");
        socket.end(`${JSON.stringify({ ok: true })}\n`);
      } catch {
        socket.end(`${JSON.stringify({ ok: false, code: "PROCESS_CONTROL_INVALID" })}\n`);
      }
    });
  });
  controlServer.listen(manifest.controlPath);

  child.stdout.on("data", (chunk: Buffer | string) => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    offsets.stdout += value.byteLength;
    appendBounded(manifest.stdoutPath, value, manifest.maxLogBytes);
    atomicallyWrite(manifest.cursorPath, offsets);
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    offsets.stderr += value.byteLength;
    appendBounded(manifest.stderrPath, value, manifest.maxLogBytes);
    atomicallyWrite(manifest.cursorPath, offsets);
  });
  child.once("error", () => finalize(null, null));
  child.once("close", (exitCode, signal) => {
    controlServer.close();
    try { unlinkSync(manifest.controlPath); } catch { /* cleanup is best effort */ }
    finalize(exitCode, signal);
    process.exitCode = exitCode ?? 1;
  });
}

main().catch((error) => {
  process.exitCode = 1;
  const manifestPath = process.argv[2];
  try {
    if (manifestPath) {
      const manifest = loadManifest(manifestPath);
      atomicallyWrite(manifest.resultPath, {
        version: 1,
        started: false,
        finishedAt: new Date().toISOString(),
        errorCode: "PROCESS_WRAPPER_FAILED",
      });
    }
  } catch { /* preserve the original failure boundary */ }
  console.error(error instanceof Error ? error.message : String(error));
});
