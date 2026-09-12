import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { applyPatch as applyUnifiedPatch, parsePatch } from "diff";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import { ConflictError, LimitError, PolicyError, RecoveryRequiredError } from "./errors.js";
import { withPathLocks } from "./path-lock.js";
import { PathPolicy } from "./policy.js";

const MAX_PATCH_COUNT = 100;
const MAX_TOTAL_PATCH_BYTES = 4 * 1024 * 1024;
const MAX_TRANSACTION_BYTES = 16 * 1024 * 1024;
const MAX_JOURNALS = 32;
const JOURNAL_VERSION = 1;

type JournalState = "prepared" | "committing" | "committed";

export interface PatchSetInput {
  path: string;
  patch: string;
  expectedSha256: string;
}

interface PreparedPatch {
  target: string;
  displayPath: string;
  original: Buffer;
  replacement: Buffer;
  originalSha256: string;
  newSha256: string;
  mode: number;
  temp: string;
  backup: string;
}

interface JournalEntry {
  target: string;
  displayPath: string;
  temp: string;
  backup: string;
  originalSha256: string;
  newSha256: string;
  mode: number;
}

interface PatchJournal {
  version: 1;
  transactionId: string;
  scopeFingerprint: string;
  state: JournalState;
  createdAt: string;
  entries: JournalEntry[];
}

export interface PatchSetResult {
  recoveredTransactions: number;
  applied: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
}

function requirePatchCount(count: number): void {
  if (count < 1 || count > MAX_PATCH_COUNT) {
    throw new LimitError(`Patch set must contain between 1 and ${MAX_PATCH_COUNT} entries.`);
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
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

async function readRegularNoFollow(candidate: string, maxBytes: number): Promise<{ buffer: Buffer; mode: number }> {
  let handle;
  try {
    handle = await open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw new PolicyError("Patch-set targets must be regular files.");
    if (info.size > maxBytes) {
      throw new LimitError("Patch-set target exceeds the configured read limit.", { size: info.size, limit: maxBytes });
    }
    const buffer = await handle.readFile();
    return { buffer, mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new PolicyError("Patch-set targets may not be symbolic links.");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function validateUnifiedPatch(patchText: string): void {
  let parsed;
  try {
    parsed = parsePatch(patchText);
  } catch {
    throw new ConflictError("Patch is not a valid unified diff.");
  }
  if (parsed.length !== 1 || parsed[0]!.hunks.length < 1) {
    throw new ConflictError("Patch must contain exactly one unified-diff file with at least one hunk.");
  }
  for (const hunk of parsed[0]!.hunks) {
    if (!Number.isInteger(hunk.oldStart)
      || !Number.isInteger(hunk.oldLines)
      || !Number.isInteger(hunk.newStart)
      || !Number.isInteger(hunk.newLines)
      || hunk.oldLines < 0
      || hunk.newLines < 0
      || hunk.lines.length < 1) {
      throw new ConflictError("Patch contains an invalid unified-diff hunk.");
    }
  }
}

function scopeFingerprint(roots: string[]): string {
  const sorted = [...roots].sort();
  const hash = createHash("sha256").update("roots\0");
  for (const [index, root] of sorted.entries()) {
    if (index > 0) hash.update("\0");
    hash.update(root);
  }
  return hash.digest("hex");
}

function journalShape(value: unknown): value is PatchJournal {
  if (!value || typeof value !== "object") return false;
  const journal = value as Partial<PatchJournal>;
  if (journal.version !== JOURNAL_VERSION) return false;
  if (typeof journal.transactionId !== "string" || typeof journal.scopeFingerprint !== "string") return false;
  if (journal.state !== "prepared" && journal.state !== "committing" && journal.state !== "committed") return false;
  if (typeof journal.createdAt !== "string" || !Array.isArray(journal.entries) || journal.entries.length < 1 || journal.entries.length > MAX_PATCH_COUNT) return false;
  return journal.entries.every((entry) => Boolean(entry)
    && typeof entry.target === "string"
    && typeof entry.displayPath === "string"
    && typeof entry.temp === "string"
    && typeof entry.backup === "string"
    && typeof entry.originalSha256 === "string"
    && /^[a-f0-9]{64}$/.test(entry.originalSha256)
    && typeof entry.newSha256 === "string"
    && /^[a-f0-9]{64}$/.test(entry.newSha256)
    && Number.isInteger(entry.mode));
}

async function safeUnlink(candidate: string): Promise<void> {
  await unlink(candidate).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}

export class PatchSetService {
  private readonly fingerprint: string;
  private readonly journalDirectory: string;

  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    stateRoot: string,
    private readonly limits: LimitsConfig,
  ) {
    this.fingerprint = scopeFingerprint(policy.roots);
    this.journalDirectory = path.join(stateRoot, "patch-transactions", this.fingerprint);
  }

  private journalPath(transactionId: string): string {
    return path.join(this.journalDirectory, `${transactionId}.json`);
  }

  private async writeJournal(journal: PatchJournal): Promise<void> {
    await mkdir(this.journalDirectory, { recursive: true, mode: 0o700 });
    const destination = this.journalPath(journal.transactionId);
    const temp = path.join(this.journalDirectory, `.${journal.transactionId}.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(journal, null, 2)}\n`;
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, destination);
    } catch (error) {
      await safeUnlink(temp);
      throw error;
    }
  }

  private validateJournalEntry(entry: JournalEntry): void {
    const root = this.policy.roots.find((candidate) => isInside(candidate, entry.target));
    if (!root) throw new RecoveryRequiredError("Patch transaction journal references a target outside the active authority roots.");
    const directory = path.dirname(entry.target);
    if (path.dirname(entry.temp) !== directory || path.dirname(entry.backup) !== directory) {
      throw new RecoveryRequiredError("Patch transaction journal contains invalid transaction artifact paths.");
    }
    if (!path.basename(entry.temp).startsWith(`.${path.basename(entry.target)}.`)
      || !path.basename(entry.temp).endsWith(".next")
      || !path.basename(entry.backup).startsWith(`.${path.basename(entry.target)}.`)
      || !path.basename(entry.backup).endsWith(".backup")) {
      throw new RecoveryRequiredError("Patch transaction journal contains malformed artifact names.");
    }
  }

  private async targetHash(candidate: string): Promise<string | null> {
    try {
      const { buffer } = await readRegularNoFollow(candidate, this.limits.maxReadBytes);
      return sha256(buffer);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async cleanupJournal(journal: PatchJournal, journalPath: string): Promise<void> {
    for (const entry of journal.entries) {
      await safeUnlink(entry.temp);
      await safeUnlink(entry.backup);
    }
    await safeUnlink(journalPath);
  }

  private async rollbackCommitting(journal: PatchJournal, journalPath: string): Promise<void> {
    for (const entry of journal.entries) {
      this.validateJournalEntry(entry);
      const currentHash = await this.targetHash(entry.target);
      if (currentHash === entry.originalSha256) continue;
      if (currentHash !== entry.newSha256) {
        throw new RecoveryRequiredError("Patch transaction recovery found an externally modified target.");
      }
      if (!(await exists(entry.backup))) {
        throw new RecoveryRequiredError("Patch transaction recovery is missing an original backup.");
      }
      const backup = await readRegularNoFollow(entry.backup, this.limits.maxReadBytes);
      if (sha256(backup.buffer) !== entry.originalSha256) {
        throw new RecoveryRequiredError("Patch transaction recovery backup hash does not match the journal.");
      }
      await rename(entry.backup, entry.target);
    }
    await this.cleanupJournal(journal, journalPath);
  }

  private async recoverOne(journalPath: string): Promise<void> {
    let parsed: unknown;
    try {
      const bytes = await readFile(journalPath);
      if (bytes.byteLength > this.limits.maxWriteBytes) {
        throw new RecoveryRequiredError("Patch transaction journal exceeds its bounded size.");
      }
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if (error instanceof RecoveryRequiredError) throw error;
      throw new RecoveryRequiredError("Patch transaction journal is unreadable or malformed.");
    }
    if (!journalShape(parsed) || parsed.scopeFingerprint !== this.fingerprint) {
      throw new RecoveryRequiredError("Patch transaction journal is invalid for the active authority scope.");
    }
    const journal = parsed;
    for (const entry of journal.entries) this.validateJournalEntry(entry);

    if (journal.state === "prepared") {
      for (const entry of journal.entries) {
        const currentHash = await this.targetHash(entry.target);
        if (currentHash !== entry.originalSha256) {
          throw new RecoveryRequiredError("Prepared patch transaction target changed before recovery.");
        }
      }
      await this.cleanupJournal(journal, journalPath);
      return;
    }

    if (journal.state === "committing") {
      await this.rollbackCommitting(journal, journalPath);
      return;
    }

    for (const entry of journal.entries) {
      const currentHash = await this.targetHash(entry.target);
      if (currentHash !== entry.newSha256) {
        throw new RecoveryRequiredError("Committed patch transaction target no longer matches the journal.");
      }
    }
    await this.cleanupJournal(journal, journalPath);
  }

  private async recoverPending(): Promise<number> {
    let entries;
    try {
      entries = await readdir(this.journalDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    const journals = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.journalDirectory, entry.name))
      .sort();
    if (journals.length > MAX_JOURNALS) {
      throw new RecoveryRequiredError("Too many pending patch transaction journals require operator recovery.");
    }
    for (const journal of journals) await this.recoverOne(journal);
    return journals.length;
  }

  private async prepare(inputs: PatchSetInput[], transactionId: string): Promise<PreparedPatch[]> {
    requirePatchCount(inputs.length);
    let patchBytes = 0;
    const prepared: PreparedPatch[] = [];
    const seen = new Set<string>();
    let transactionBytes = 0;

    for (const input of inputs) {
      patchBytes += Buffer.byteLength(input.patch, "utf8");
      if (patchBytes > MAX_TOTAL_PATCH_BYTES) throw new LimitError("Patch-set input exceeds its bounded patch size.");
      const target = await this.policy.resolve(input.path);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new PolicyError("Patch-set targets may not be symbolic links.");
      if (!info.isFile()) throw new PolicyError("Patch-set targets must be regular files.");
      const canonical = await import("node:fs/promises").then(({ realpath }) => realpath(target));
      if (seen.has(canonical)) throw new PolicyError("Patch-set paths must identify distinct files.");
      seen.add(canonical);

      const current = await readRegularNoFollow(target, this.limits.maxReadBytes);
      const currentSha256 = sha256(current.buffer);
      if (currentSha256 !== input.expectedSha256) {
        throw new ConflictError("File changed since it was read.", {
          expectedSha256: input.expectedSha256,
          currentSha256,
        });
      }
      const source = current.buffer.toString("utf8");
      validateUnifiedPatch(input.patch);
      const patched = applyUnifiedPatch(source, input.patch);
      if (patched === false) throw new ConflictError("Patch does not apply cleanly to the current file.");
      const replacement = Buffer.from(patched, "utf8");
      if (replacement.byteLength > this.limits.maxWriteBytes) {
        throw new LimitError("Patched file exceeds configured byte limit.", {
          bytes: replacement.byteLength,
          limit: this.limits.maxWriteBytes,
        });
      }
      transactionBytes += current.buffer.byteLength + replacement.byteLength;
      if (transactionBytes > MAX_TRANSACTION_BYTES) throw new LimitError("Patch transaction exceeds its bounded byte budget.");
      const basename = path.basename(target);
      prepared.push({
        target,
        displayPath: this.policy.display(target),
        original: current.buffer,
        replacement,
        originalSha256: currentSha256,
        newSha256: sha256(replacement),
        mode: current.mode,
        temp: path.join(path.dirname(target), `.${basename}.${transactionId}.next`),
        backup: path.join(path.dirname(target), `.${basename}.${transactionId}.backup`),
      });
    }
    return prepared;
  }

  private async materializeTransaction(entries: PreparedPatch[]): Promise<void> {
    const created: string[] = [];
    try {
      for (const entry of entries) {
        const backupHandle = await open(entry.backup, "wx", entry.mode);
        try {
          await backupHandle.writeFile(entry.original);
          await backupHandle.sync();
        } finally {
          await backupHandle.close();
        }
        created.push(entry.backup);

        const tempHandle = await open(entry.temp, "wx", entry.mode);
        try {
          await tempHandle.writeFile(entry.replacement);
          await tempHandle.sync();
        } finally {
          await tempHandle.close();
        }
        created.push(entry.temp);
      }
    } catch (error) {
      await Promise.all(created.map((candidate) => safeUnlink(candidate)));
      throw error;
    }
  }

  private toJournal(transactionId: string, state: JournalState, entries: PreparedPatch[]): PatchJournal {
    return {
      version: JOURNAL_VERSION,
      transactionId,
      scopeFingerprint: this.fingerprint,
      state,
      createdAt: new Date().toISOString(),
      entries: entries.map((entry) => ({
        target: entry.target,
        displayPath: entry.displayPath,
        temp: entry.temp,
        backup: entry.backup,
        originalSha256: entry.originalSha256,
        newSha256: entry.newSha256,
        mode: entry.mode,
      })),
    };
  }

  private async cleanupPrepared(entries: PreparedPatch[], journalPath?: string): Promise<void> {
    for (const entry of entries) {
      await safeUnlink(entry.temp);
      await safeUnlink(entry.backup);
    }
    if (journalPath) await safeUnlink(journalPath);
  }

  async apply(inputs: PatchSetInput[]): Promise<PatchSetResult> {
    requirePatchCount(inputs.length);
    const targets = await Promise.all(inputs.map((input) => this.policy.resolve(input.path)));
    return withPathLocks(targets, () => this.applyLocked(inputs));
  }

  private async applyLocked(inputs: PatchSetInput[]): Promise<PatchSetResult> {
    const recoveredTransactions = await this.recoverPending();
    const transactionId = randomUUID();
    const entries = await this.prepare(inputs, transactionId);
    const journalPath = this.journalPath(transactionId);
    const patchBytes = inputs.reduce((sum, item) => sum + Buffer.byteLength(item.patch, "utf8"), 0);

    return this.audit.run(
      "fs.patch_set",
      `. (${entries.length} files)`,
      async () => {
        await this.materializeTransaction(entries);
        let journal = this.toJournal(transactionId, "prepared", entries);
        try {
          await this.writeJournal(journal);

          for (const entry of entries) {
            const current = await readRegularNoFollow(entry.target, this.limits.maxReadBytes);
            if (sha256(current.buffer) !== entry.originalSha256) {
              await this.cleanupPrepared(entries, journalPath);
              throw new ConflictError("File changed after patch-set validation and before commit.", {
                path: entry.displayPath,
              });
            }
          }

          journal = { ...journal, state: "committing" };
          await this.writeJournal(journal);
          try {
            for (const entry of entries) await rename(entry.temp, entry.target);
          } catch (error) {
            try {
              await this.rollbackCommitting(journal, journalPath);
            } catch (recoveryError) {
              if (recoveryError instanceof RecoveryRequiredError) throw recoveryError;
              throw new RecoveryRequiredError("Patch transaction failed and automatic rollback did not complete.");
            }
            throw error;
          }

          journal = { ...journal, state: "committed" };
          await this.writeJournal(journal);
          await this.cleanupJournal(journal, journalPath);
          return {
            recoveredTransactions,
            applied: entries.map((entry) => ({
              path: entry.displayPath,
              bytes: entry.replacement.byteLength,
              sha256: entry.newSha256,
            })),
          };
        } catch (error) {
          if (!(error instanceof RecoveryRequiredError)) {
            const journalExists = await exists(journalPath);
            if (!journalExists) await this.cleanupPrepared(entries);
          }
          throw error;
        }
      },
      { fileCount: entries.length, patchBytes, recoveredTransactions },
    );
  }
}
