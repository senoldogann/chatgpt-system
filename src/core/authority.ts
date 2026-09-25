import { createHash, randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  AuthorityDeniedError,
  AuthorityExpiredError,
  AuthorityRequiredError,
} from "./errors.js";

// Serbest mod: tek profil vardır (project). user/admin ayrımı kaldırıldı.
// Her lease tam yetkilidir; kabiliyet kapıları yalnızca startup flaglerine bakar.
export type AuthorityProfile = "project";

export interface AuthorityContext {
  profile: AuthorityProfile;
  roots: string[];
  terminalEnabled: boolean;
  commands: string[];
  createdAt: string;
  expiresAt: string;
}

export interface StartAuthorityRequest {
  profile: AuthorityProfile;
  projectRoots?: string[];
  requestedTtlSeconds?: number;
}

export interface AuthorityLeaseView extends AuthorityContext {
  leaseId: string;
}

export interface AuthorityLifecycleAuditEvent {
  event: "authority.start" | "authority.end" | "authority.expired";
  profile: AuthorityProfile;
  rootCount: number;
  scopeDigest: string;
  expiresAt?: string;
}

/** Çözülemeyen lease için kaba ret nedeni ve sayacı. */
export type AuthorityDenialReason = "missing" | "unknown";

export interface AuthorityDenialAuditEvent {
  event: "authority.denied";
  reason: AuthorityDenialReason;
  deniedCount: number;
  windowStartedAt: string;
}

export type AuthorityAuditEvent = AuthorityLifecycleAuditEvent | AuthorityDenialAuditEvent;

export interface AuthorityManagerOptions {
  homeDir: string;
  commands: string[];
  terminalEnabled: boolean;
  now?: () => number;
  audit?: (event: AuthorityAuditEvent) => void | Promise<void>;
}

interface StoredLease extends AuthorityContext {
  expiresAtMs: number;
}

// Red kayıtları saldırgan tarafından tetiklenebilir, bu yüzden pencere başına özetlenir.
const DENIAL_WINDOW_MS = 60_000;

interface DenialWindow {
  startedAtMs: number;
  startedAt: string;
  pending: number;
}

const PROJECT_MAX_TTL_SECONDS = 8 * 60 * 60;

function digestLease(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function digestScope(roots: string[]): string {
  return createHash("sha256").update(roots.join("\0")).digest("hex");
}

function newLeaseId(): string {
  return randomBytes(32).toString("base64url");
}

function cloneContext(lease: StoredLease): AuthorityContext {
  return {
    profile: lease.profile,
    roots: [...lease.roots],
    terminalEnabled: lease.terminalEnabled,
    commands: [...lease.commands],
    createdAt: lease.createdAt,
    expiresAt: lease.expiresAt,
  };
}

export async function canonicalizeProjectRoots(
  homeDirInput: string,
  requestedRootsInput: string[],
): Promise<string[]> {
  const home = await realpath(path.resolve(homeDirInput));
  const filesystemRoot = path.parse(home).root;
  const requestedRoots = requestedRootsInput.map((root) => root.trim()).filter(Boolean);
  if (requestedRoots.length === 0) {
    throw new AuthorityDeniedError("Project authority requires at least one explicit project root.");
  }

  const canonicalRoots: string[] = [];
  for (const requestedRoot of requestedRoots) {
    let canonical: string;
    try {
      canonical = await realpath(path.resolve(requestedRoot));
      const info = await stat(canonical);
      if (!info.isDirectory()) {
        throw new AuthorityDeniedError("Project authority roots must be directories.", { root: requestedRoot });
      }
    } catch (error) {
      if (error instanceof AuthorityDeniedError) throw error;
      const causeCode = (error as NodeJS.ErrnoException).code;
      throw new AuthorityDeniedError(
        "Project authority root could not be resolved.",
        {
          root: requestedRoot,
          ...(typeof causeCode === "string" ? { causeCode } : {}),
        },
      );
    }
    if (canonical === filesystemRoot || canonical === home) {
      throw new AuthorityDeniedError("Project authority may not target the filesystem root or the entire home directory.", {
        root: requestedRoot,
      });
    }
    canonicalRoots.push(canonical);
  }

  return [...new Set(canonicalRoots)];
}

export class AuthorityManager {
  private readonly leases = new Map<string, StoredLease>();
  private readonly now: () => number;
  private readonly homeDirInput: string;
  private readonly commands: string[];
  private readonly terminalGateEnabled: boolean;
  private readonly audit: ((event: AuthorityAuditEvent) => void | Promise<void>) | undefined;
  private readonly denialWindows = new Map<AuthorityDenialReason, DenialWindow>();
  private auditChain: Promise<void> = Promise.resolve();

  constructor(options: AuthorityManagerOptions) {
    this.homeDirInput = options.homeDir;
    this.commands = [...new Set(options.commands)];
    this.terminalGateEnabled = options.terminalEnabled;
    this.now = options.now ?? Date.now;
    this.audit = options.audit;
  }

  async start(request: StartAuthorityRequest): Promise<AuthorityLeaseView> {
    const roots = await this.resolveRoots(request);
    const nowMs = this.now();
    const requestedTtl = request.requestedTtlSeconds ?? PROJECT_MAX_TTL_SECONDS;
    const ttlSeconds = Math.max(1, Math.min(requestedTtl, PROJECT_MAX_TTL_SECONDS));
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    const leaseId = newLeaseId();
    // Serbest mod: terminal kabiliyeti profile değil global gate'e bağlıdır.
    const terminalEnabled = this.terminalGateEnabled;

    const stored: StoredLease = {
      profile: "project",
      roots: [...roots],
      terminalEnabled,
      commands: terminalEnabled ? [...this.commands] : [],
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };

    this.leases.set(digestLease(leaseId), stored);
    this.emitAudit(stored, "authority.start", true);
    return { leaseId, ...cloneContext(stored) };
  }

  resolve(leaseId: string): AuthorityContext {
    const stored = this.lookup(leaseId);
    return cloneContext(stored);
  }

  status(leaseId: string): AuthorityLeaseView {
    const stored = this.lookup(leaseId);
    return { leaseId, ...cloneContext(stored) };
  }

  end(leaseId: string): { ended: true } {
    const key = this.requireLeaseKey(leaseId);
    const stored = this.leases.get(key);
    if (!stored) {
      this.recordDenial("unknown");
      throw new AuthorityRequiredError();
    }
    this.leases.delete(key);
    this.emitAudit(stored, "authority.end", false);
    return { ended: true };
  }

  async flushAudit(): Promise<void> {
    await this.auditChain;
  }

  private lookup(leaseId: string): StoredLease {
    const key = this.requireLeaseKey(leaseId);
    const stored = this.leases.get(key);
    if (!stored) {
      this.recordDenial("unknown");
      throw new AuthorityRequiredError();
    }
    if (Number.isFinite(stored.expiresAtMs) && this.now() > stored.expiresAtMs) {
      this.leases.delete(key);
      this.emitAudit(stored, "authority.expired", false);
      throw new AuthorityExpiredError();
    }
    return stored;
  }

  private requireLeaseKey(leaseId: string): string {
    if (!leaseId.trim()) {
      this.recordDenial("missing");
      throw new AuthorityRequiredError();
    }
    return digestLease(leaseId);
  }

  /** Sahte lease seli audit dosyasını şişirmesin diye reddedişler pencerede birleştirilir. */
  private recordDenial(reason: AuthorityDenialReason): void {
    const nowMs = this.now();
    const open = this.denialWindows.get(reason);
    if (!open) {
      const startedAt = new Date(nowMs).toISOString();
      this.denialWindows.set(reason, { startedAtMs: nowMs, startedAt, pending: 0 });
      this.queueAudit({ event: "authority.denied", reason, deniedCount: 1, windowStartedAt: startedAt });
      return;
    }
    open.pending += 1;
    if (nowMs - open.startedAtMs < DENIAL_WINDOW_MS) return;
    this.queueAudit({
      event: "authority.denied",
      reason,
      deniedCount: open.pending,
      windowStartedAt: open.startedAt,
    });
    this.denialWindows.delete(reason);
  }

  private emitAudit(
    lease: StoredLease,
    event: AuthorityLifecycleAuditEvent["event"],
    includeExpiry: boolean,
  ): void {
    this.queueAudit({
      event,
      profile: lease.profile,
      rootCount: lease.roots.length,
      scopeDigest: digestScope(lease.roots),
      ...(includeExpiry ? { expiresAt: lease.expiresAt } : {}),
    });
  }

  private queueAudit(record: AuthorityAuditEvent): void {
    if (!this.audit) return;

    this.auditChain = this.auditChain.then(async () => {
      try {
        await this.audit?.(record);
      } catch {
        // Yetki denetimi audit deposuna bağlı kalmadan fail-closed çalışır.
      }
    });
  }

  private async resolveRoots(request: StartAuthorityRequest): Promise<string[]> {
    return canonicalizeProjectRoots(this.homeDirInput, request.projectRoots ?? []);
  }
}
