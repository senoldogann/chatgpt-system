import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { BrowserError } from "./errors.js";

export interface ExistingChromeDiscoveryInput {
  userDataDir: string;
}

export interface ExistingChromeEndpoint {
  endpoint: string;
}

const DEVTOOLS_ACTIVE_PORT_MAX_BYTES = 4096;
const BROWSER_PATH_PATTERN = /^\/devtools\/browser\/[A-Za-z0-9._~-]+$/;
const PORT_PATTERN = /^[1-9][0-9]{0,4}$/;
const UNAVAILABLE_MESSAGE =
  "Existing Chrome remote debugging is unavailable. Enable it in chrome://inspect/#remote-debugging and retry.";

function unavailable(): BrowserError {
  return new BrowserError("BROWSER_UNAVAILABLE", UNAVAILABLE_MESSAGE);
}

function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

async function closeMetadataHandle(handle: FileHandle): Promise<void> {
  try {
    await handle.close();
  } catch (error) {
    if (isFilesystemError(error)) throw unavailable();
    throw error;
  }
}

async function openMetadata(metadataPath: string): Promise<FileHandle> {
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(metadataPath);
  } catch (error) {
    if (isFilesystemError(error)) throw unavailable();
    throw error;
  }

  if (!before.isFile() || before.isSymbolicLink()) throw unavailable();

  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  let handle: FileHandle;
  try {
    handle = await open(metadataPath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isFilesystemError(error)) throw unavailable();
    throw error;
  }

  try {
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
      await closeMetadataHandle(handle);
      throw unavailable();
    }
    return handle;
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    await closeMetadataHandle(handle);
    if (isFilesystemError(error)) throw unavailable();
    throw error;
  }
}

async function readBoundedMetadata(handle: FileHandle): Promise<string> {
  try {
    const stats = await handle.stat();
    if (stats.size > DEVTOOLS_ACTIVE_PORT_MAX_BYTES) throw unavailable();

    const buffer = Buffer.alloc(DEVTOOLS_ACTIVE_PORT_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > DEVTOOLS_ACTIVE_PORT_MAX_BYTES) throw unavailable();

    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      throw unavailable();
    }
  } catch (error) {
    if (error instanceof BrowserError) throw error;
    if (isFilesystemError(error)) throw unavailable();
    throw error;
  }
}

function parseMetadata(raw: string): ExistingChromeEndpoint {
  const normalized = raw.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) throw unavailable();

  const lines = normalized.split("\n");
  if (lines.length === 3 && lines[2] === "") lines.pop();
  if (lines.length !== 2) throw unavailable();

  const [rawPort, browserPath] = lines;
  if (rawPort === undefined || browserPath === undefined) throw unavailable();
  if (!PORT_PATTERN.test(rawPort)) throw unavailable();

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable();
  if (!BROWSER_PATH_PATTERN.test(browserPath)) throw unavailable();

  return { endpoint: `ws://127.0.0.1:${port}${browserPath}` };
}

export function defaultExistingChromeUserDataDir(
  platform: NodeJS.Platform,
  homeDir: string,
  localAppData: string | undefined,
): string {
  if (platform === "darwin") {
    return path.posix.join(homeDir, "Library", "Application Support", "Google", "Chrome");
  }
  if (platform === "linux") {
    return path.posix.join(homeDir, ".config", "google-chrome");
  }
  if (platform === "win32" && localAppData !== undefined && localAppData.length > 0) {
    return path.win32.join(localAppData, "Google", "Chrome", "User Data");
  }
  throw unavailable();
}

export async function discoverExistingChromeEndpoint(
  input: ExistingChromeDiscoveryInput,
): Promise<ExistingChromeEndpoint> {
  const metadataPath = path.join(input.userDataDir, "DevToolsActivePort");
  const handle = await openMetadata(metadataPath);
  try {
    return parseMetadata(await readBoundedMetadata(handle));
  } finally {
    await closeMetadataHandle(handle);
  }
}
