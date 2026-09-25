import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";

export const MACOS_AUTHORITY_INSTALL_ROOT = "/Library/Application Support/chatgpt-system";
export const MACOS_AUTHORITY_BIN_DIR = `${MACOS_AUTHORITY_INSTALL_ROOT}/bin`;
export const MACOS_AUTHORITY_ETC_DIR = `${MACOS_AUTHORITY_INSTALL_ROOT}/etc`;
export const MACOS_AUTHORITY_HELPER_PATH = `${MACOS_AUTHORITY_BIN_DIR}/chatgpt-system-authority-broker`;
export const MACOS_AUTHORITY_METADATA_PATH = `${MACOS_AUTHORITY_ETC_DIR}/authority-broker.sha256`;

export interface NativeHelperFileInfo {
  kind: "file" | "directory" | "symlink" | "other";
  uid: number;
  mode: number;
}

export interface NativeHelperTrustFs {
  lstat(path: string): Promise<NativeHelperFileInfo>;
  readFile(path: string): Promise<Buffer>;
}

export interface NativeHelperTrustValidator {
  validate(): Promise<void>;
}

export interface MacOSNativeHelperTrustValidatorOptions {
  fs?: NativeHelperTrustFs;
}

class NativeHelperTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeHelperTrustError";
  }
}

function classify(info: Awaited<ReturnType<typeof lstat>>): NativeHelperFileInfo["kind"] {
  if (info.isSymbolicLink()) return "symlink";
  if (info.isFile()) return "file";
  if (info.isDirectory()) return "directory";
  return "other";
}

const defaultFs: NativeHelperTrustFs = {
  async lstat(target) {
    const info = await lstat(target);
    return {
      kind: classify(info),
      uid: info.uid,
      mode: info.mode & 0o7777,
    };
  },
  async readFile(target) {
    return readFile(target);
  },
};

function assertProtected(
  target: string,
  info: NativeHelperFileInfo,
  expectedKind: "file" | "directory",
): void {
  if (info.kind !== expectedKind) {
    throw new NativeHelperTrustError(`Untrusted native authority path type: ${target}`);
  }
  if (info.uid !== 0) {
    throw new NativeHelperTrustError(`Untrusted native authority ownership: ${target}`);
  }
  if ((info.mode & 0o022) !== 0) {
    throw new NativeHelperTrustError(`Untrusted native authority permissions: ${target}`);
  }
}

function parseExpectedHash(metadata: Buffer): Buffer {
  const text = metadata.toString("utf8");
  const match = /^([a-f0-9]{64})\n?$/.exec(text);
  const hash = match?.[1];
  if (!hash) throw new NativeHelperTrustError("Invalid native authority trust metadata.");
  return Buffer.from(hash, "hex");
}

export class MacOSNativeHelperTrustValidator implements NativeHelperTrustValidator {
  private readonly fs: NativeHelperTrustFs;

  constructor(options: MacOSNativeHelperTrustValidatorOptions = {}) {
    this.fs = options.fs ?? defaultFs;
  }

  async validate(): Promise<void> {
    try {
      const [installRoot, binDir, etcDir, helper, metadata] = await Promise.all([
        this.fs.lstat(MACOS_AUTHORITY_INSTALL_ROOT),
        this.fs.lstat(MACOS_AUTHORITY_BIN_DIR),
        this.fs.lstat(MACOS_AUTHORITY_ETC_DIR),
        this.fs.lstat(MACOS_AUTHORITY_HELPER_PATH),
        this.fs.lstat(MACOS_AUTHORITY_METADATA_PATH),
      ]);

      assertProtected(MACOS_AUTHORITY_INSTALL_ROOT, installRoot, "directory");
      assertProtected(MACOS_AUTHORITY_BIN_DIR, binDir, "directory");
      assertProtected(MACOS_AUTHORITY_ETC_DIR, etcDir, "directory");
      assertProtected(MACOS_AUTHORITY_HELPER_PATH, helper, "file");
      assertProtected(MACOS_AUTHORITY_METADATA_PATH, metadata, "file");

      const [helperBytes, metadataBytes] = await Promise.all([
        this.fs.readFile(MACOS_AUTHORITY_HELPER_PATH),
        this.fs.readFile(MACOS_AUTHORITY_METADATA_PATH),
      ]);
      const expected = parseExpectedHash(metadataBytes);
      const actual = createHash("sha256").update(helperBytes).digest();
      if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
        throw new NativeHelperTrustError("Native authority helper identity mismatch.");
      }
    } catch (error) {
      if (error instanceof NativeHelperTrustError) throw error;
      throw new NativeHelperTrustError("Native authority helper installation is unavailable or untrusted.");
    }
  }
}
