import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { applyPatch as applyUnifiedPatch } from "diff";
import { AuditLogger } from "./audit.js";
import { ConflictError, LimitError, PolicyError } from "./errors.js";
import type { LimitsConfig } from "./config.js";
import { PathPolicy } from "./policy.js";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class FileSystemService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly limits: LimitsConfig,
  ) {}

  async list(input: string): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.list", this.policy.display(resolved), async () => {
      const entries = await readdir(resolved, { withFileTypes: true });
      if (entries.length > this.limits.maxDirectoryEntries) {
        throw new LimitError("Directory contains too many entries.", {
          count: entries.length,
          limit: this.limits.maxDirectoryEntries,
        });
      }
      return {
        path: this.policy.display(resolved),
        entries: entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
        })),
      };
    });
  }

  async stat(input: string): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.stat", this.policy.display(resolved), async () => {
      const info = await lstat(resolved);
      const result: Record<string, unknown> = {
        path: this.policy.display(resolved),
        type: info.isDirectory() ? "directory" : info.isFile() ? "file" : info.isSymbolicLink() ? "symlink" : "other",
        size: info.size,
        mode: `0${(info.mode & 0o777).toString(8)}`,
        modifiedAt: info.mtime.toISOString(),
      };
      if (info.isFile() && info.size <= this.limits.maxReadBytes) {
        result.sha256 = sha256(await readFile(resolved));
      }
      return result;
    });
  }

  async read(input: string, encoding: "utf8" | "base64" = "utf8"): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.read", this.policy.display(resolved), async () => {
      const info = await stat(resolved);
      if (!info.isFile()) throw new PolicyError("Only regular files can be read.");
      if (info.size > this.limits.maxReadBytes) {
        throw new LimitError("File exceeds read limit.", { size: info.size, limit: this.limits.maxReadBytes });
      }
      const buffer = await readFile(resolved);
      return {
        path: this.policy.display(resolved),
        encoding,
        content: buffer.toString(encoding),
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
      };
    });
  }

  private async verifyExpectedHash(resolved: string, expectedSha256?: string): Promise<{ exists: boolean; mode?: number }> {
    if (!(await exists(resolved))) {
      if (expectedSha256) {
        throw new ConflictError("File does not exist but an expected hash was supplied.", { expectedSha256 });
      }
      return { exists: false };
    }

    const info = await lstat(resolved);
    if (!info.isFile()) throw new PolicyError("Target must be a regular file.");
    const current = await readFile(resolved);
    const currentSha256 = sha256(current);
    if (!expectedSha256) {
      throw new ConflictError("Existing files require expectedSha256 to prevent lost updates.", { currentSha256 });
    }
    if (currentSha256 !== expectedSha256) {
      throw new ConflictError("File changed since it was read.", { expectedSha256, currentSha256 });
    }
    return { exists: true, mode: info.mode & 0o777 };
  }

  private async atomicWrite(resolved: string, buffer: Buffer, mode?: number): Promise<void> {
    await mkdir(path.dirname(resolved), { recursive: true });
    const temp = path.join(path.dirname(resolved), `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", mode ?? 0o600);
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, resolved);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async write(
    input: string,
    content: string,
    encoding: "utf8" | "base64" = "utf8",
    expectedSha256?: string,
  ): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    const buffer = Buffer.from(content, encoding);
    if (buffer.byteLength > this.limits.maxWriteBytes) {
      throw new LimitError("Write exceeds configured byte limit.", { bytes: buffer.byteLength, limit: this.limits.maxWriteBytes });
    }

    return this.audit.run("fs.write", this.policy.display(resolved), async () => {
      const current = await this.verifyExpectedHash(resolved, expectedSha256);
      await this.atomicWrite(resolved, buffer, current.mode);
      return {
        path: this.policy.display(resolved),
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        created: !current.exists,
      };
    }, { bytes: buffer.byteLength });
  }

  async patch(input: string, patchText: string, expectedSha256: string): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.patch", this.policy.display(resolved), async () => {
      await this.verifyExpectedHash(resolved, expectedSha256);
      const source = await readFile(resolved, "utf8");
      const result = applyUnifiedPatch(source, patchText);
      if (result === false) throw new ConflictError("Patch does not apply cleanly to the current file.");
      const buffer = Buffer.from(result, "utf8");
      if (buffer.byteLength > this.limits.maxWriteBytes) {
        throw new LimitError("Patched file exceeds configured byte limit.", { bytes: buffer.byteLength, limit: this.limits.maxWriteBytes });
      }
      const info = await lstat(resolved);
      await this.atomicWrite(resolved, buffer, info.mode & 0o777);
      return { path: this.policy.display(resolved), bytes: buffer.byteLength, sha256: sha256(buffer) };
    }, { patchBytes: Buffer.byteLength(patchText) });
  }

  async move(sourceInput: string, destinationInput: string, expectedSha256?: string): Promise<Record<string, unknown>> {
    const source = await this.policy.resolve(sourceInput);
    const destination = await this.policy.resolve(destinationInput);
    return this.audit.run("fs.move", `${this.policy.display(source)} -> ${this.policy.display(destination)}`, async () => {
      const info = await lstat(source);
      if (info.isFile()) await this.verifyExpectedHash(source, expectedSha256);
      if (await exists(destination)) throw new ConflictError("Destination already exists.");
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(source, destination);
      return { from: this.policy.display(source), to: this.policy.display(destination) };
    });
  }

  async remove(input: string, expectedSha256?: string, recursive = false): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.remove", this.policy.display(resolved), async () => {
      if (this.policy.roots.includes(resolved)) throw new PolicyError("Removing an allowed root is forbidden.");
      const info = await lstat(resolved);
      if (info.isFile()) {
        await this.verifyExpectedHash(resolved, expectedSha256);
        await unlink(resolved);
      } else if (info.isDirectory()) {
        if (!recursive) throw new PolicyError("Directory removal requires recursive=true.");
        await rm(resolved, { recursive: true, force: false });
      } else {
        throw new PolicyError("Only regular files and directories can be removed.");
      }
      return { path: this.policy.display(resolved), removed: true };
    });
  }

  async makeDirectory(input: string): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.mkdir", this.policy.display(resolved), async () => {
      await mkdir(resolved, { recursive: true });
      return { path: this.policy.display(resolved), created: true };
    });
  }
}
