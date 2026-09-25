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
import { AuditLogger } from "../core/audit.js";
import { ConflictError, LimitError, NotFoundError, PolicyError } from "../core/errors.js";
import type { LimitsConfig } from "../core/config.js";
import { withPathLock, withPathLocks } from "../core/path-lock.js";
import { normalizeUnifiedPatchHunkHeaders, patchInvalidError, validateUnifiedPatch } from "./unified-patch.js";
import { PathPolicy } from "../core/policy.js";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function countOccurrences(source: string, search: string): number {
  let count = 0;
  for (let index = source.indexOf(search); index >= 0; index = source.indexOf(search, index + search.length)) count += 1;
  return count;
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
      const info = await lstat(resolved).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          throw new NotFoundError(`The requested path does not exist: ${this.policy.display(resolved)}.`);
        }
        throw error;
      });
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

  async read(
    input: string,
    encoding: "utf8" | "base64" = "utf8",
    lines: { offset?: number; limit?: number } = {},
  ): Promise<Record<string, unknown>> {
    const ranged = lines.offset !== undefined || lines.limit !== undefined;
    if (ranged && encoding !== "utf8") throw new PolicyError("Line ranges require utf8 encoding.");
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.read", this.policy.display(resolved), async () => {
      const info = await stat(resolved);
      if (!info.isFile()) throw new PolicyError("Only regular files can be read.");
      if (info.size > this.limits.maxReadBytes) {
        throw new LimitError("File exceeds read limit.", { size: info.size, limit: this.limits.maxReadBytes });
      }
      const buffer = await readFile(resolved);
      const base = {
        path: this.policy.display(resolved),
        encoding,
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
      };
      if (!ranged) return { ...base, content: buffer.toString(encoding) };
      // sha256 her zaman tüm dosyanındır; aralıklı okumadan sonra da güvenli
      // yazma (fs_edit/fs_write/fs_apply_patch) için kullanılabilir.
      const text = buffer.toString("utf8");
      const allLines = text.split("\n");
      if (text.endsWith("\n")) allLines.pop();
      const startLine = lines.offset ?? 1;
      const selected = allLines.slice(startLine - 1, lines.limit === undefined ? undefined : startLine - 1 + lines.limit);
      return {
        ...base,
        content: selected.join("\n"),
        range: { startLine, endLine: startLine + selected.length - 1, totalLines: allLines.length },
      };
    });
  }

  async edit(
    input: string,
    oldString: string,
    newString: string,
    options: { replaceAll?: boolean; expectedSha256?: string } = {},
  ): Promise<Record<string, unknown>> {
    if (oldString.length === 0) throw new PolicyError("oldString must not be empty; use fs_write to create or replace a whole file.");
    if (oldString === newString) throw new PolicyError("oldString and newString are identical; nothing to change.");
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.edit", this.policy.display(resolved), async () => withPathLock(resolved, async () => {
      if (!(await exists(resolved))) throw new NotFoundError("File does not exist; use fs_write to create it.");
      const info = await lstat(resolved);
      if (!info.isFile()) throw new PolicyError("Target must be a regular file.");
      if (info.size > this.limits.maxReadBytes) {
        throw new LimitError("File exceeds read limit.", { size: info.size, limit: this.limits.maxReadBytes });
      }
      const current = await readFile(resolved);
      const currentSha256 = sha256(current);
      if (options.expectedSha256 !== undefined && options.expectedSha256 !== currentSha256) {
        throw new ConflictError("File changed since it was read.", { expectedSha256: options.expectedSha256, currentSha256 });
      }
      const source = current.toString("utf8");
      let search = oldString;
      let replacement = newString;
      let matches = countOccurrences(source, search);
      // CRLF dosyada LF ile yazılmış bir eşleşme de kabul edilir; yeni metin
      // dosyanın satır sonu stiline çevrilir.
      if (matches === 0 && source.includes("\r\n") && !oldString.includes("\r\n") && oldString.includes("\n")) {
        search = oldString.replace(/\n/g, "\r\n");
        replacement = newString.replace(/\r?\n/g, "\r\n");
        matches = countOccurrences(source, search);
      }
      if (matches === 0) {
        throw new ConflictError("oldString was not found in the file.", {
          currentSha256,
          recommendedOperations: ["fs_read", "code_query"],
          guidance: "Re-read the current text and copy oldString exactly, including whitespace and indentation.",
          retryable: true,
        });
      }
      if (matches > 1 && options.replaceAll !== true) {
        throw new ConflictError("oldString matches more than one location.", {
          matches,
          currentSha256,
          guidance: "Include more surrounding lines so oldString is unique, or set replaceAll to change every occurrence.",
          retryable: true,
        });
      }
      const result = options.replaceAll === true
        ? source.split(search).join(replacement)
        : source.replace(search, () => replacement);
      const buffer = Buffer.from(result, "utf8");
      if (buffer.byteLength > this.limits.maxWriteBytes) {
        throw new LimitError("Edited file exceeds configured byte limit.", { bytes: buffer.byteLength, limit: this.limits.maxWriteBytes });
      }
      await this.atomicWrite(resolved, buffer, info.mode & 0o777);
      return {
        path: this.policy.display(resolved),
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        previousSha256: currentSha256,
        replacements: options.replaceAll === true ? matches : 1,
      };
    }), { replaceAll: options.replaceAll === true });
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

    return this.audit.run("fs.write", this.policy.display(resolved), async () => withPathLock(resolved, async () => {
      const current = await this.verifyExpectedHash(resolved, expectedSha256);
      await this.atomicWrite(resolved, buffer, current.mode);
      return {
        path: this.policy.display(resolved),
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        created: !current.exists,
      };
    }), { bytes: buffer.byteLength });
  }

  async patch(input: string, patchText: string, expectedSha256: string): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    const normalization = normalizeUnifiedPatchHunkHeaders(patchText);
    validateUnifiedPatch(normalization.patch);
    return this.audit.run("fs.patch", this.policy.display(resolved), async () => withPathLock(resolved, async () => {
      await this.verifyExpectedHash(resolved, expectedSha256);
      const source = await readFile(resolved, "utf8");
      let result: string | false;
      try {
        result = applyUnifiedPatch(source, normalization.patch);
      } catch (error) {
        throw patchInvalidError(error);
      }
      if (result === false) {
        throw new ConflictError("Patch does not apply cleanly to the current file.", {
          recommendedOperations: ["fs_read", "fs_write"],
          guidance: "Context lines no longer match the file. Re-read the current content before rebuilding the diff.",
          retryable: true,
        });
      }
      const buffer = Buffer.from(result, "utf8");
      if (buffer.byteLength > this.limits.maxWriteBytes) {
        throw new LimitError("Patched file exceeds configured byte limit.", { bytes: buffer.byteLength, limit: this.limits.maxWriteBytes });
      }
      const info = await lstat(resolved);
      await this.atomicWrite(resolved, buffer, info.mode & 0o777);
      return {
        path: this.policy.display(resolved),
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
        normalizedHunkHeaders: normalization.normalized,
      };
    }), { patchBytes: Buffer.byteLength(patchText), normalizedHunkHeaders: normalization.normalized });
  }

  async move(sourceInput: string, destinationInput: string, expectedSha256?: string): Promise<Record<string, unknown>> {
    const source = await this.policy.resolve(sourceInput);
    const destination = await this.policy.resolve(destinationInput);
    return this.audit.run("fs.move", `${this.policy.display(source)} -> ${this.policy.display(destination)}`, async () => withPathLocks([source, destination], async () => {
      const info = await lstat(source);
      if (info.isFile()) await this.verifyExpectedHash(source, expectedSha256);
      if (await exists(destination)) throw new ConflictError("Destination already exists.");
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(source, destination);
      return { from: this.policy.display(source), to: this.policy.display(destination) };
    }));
  }

  async remove(input: string, expectedSha256?: string, recursive = false): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.remove", this.policy.display(resolved), async () => withPathLock(resolved, async () => {
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
    }));
  }

  async makeDirectory(input: string): Promise<Record<string, unknown>> {
    const resolved = await this.policy.resolve(input);
    return this.audit.run("fs.mkdir", this.policy.display(resolved), async () => {
      await mkdir(resolved, { recursive: true });
      return { path: this.policy.display(resolved), created: true };
    });
  }
}
