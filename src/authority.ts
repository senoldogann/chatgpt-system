import { createHash, randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  AuthorityDeniedError,
  AuthorityExpiredError,
  AuthorityRequiredError,
} from "./errors.js";

export type AuthorityProfile = "project" | "user" | "admin";

export interface AuthorityContext {
  profile: AuthorityProfile;
  roots: string[];
  terminalEnabled: true;
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

export interface AuthorityAuditEvent {
  event: "authority.start" | "authority.end" | "authority.expired";
  profile: AuthorityProfile;
  rootCount: number;
  scopeDigest: string;
  expiresAt?: string;
}

export interface AuthorityManagerOptions {
  homeDir: string;
  commands: string[];
  now?: () => number;
  audit?: (event: AuthorityAuditEvent) => void | Promise<void>;
}

interface StoredLease extends AuthorityContext {
  expiresAtMs: number;
}

const PROFILE_MAX_TTL_SECONDS: Record<AuthorityProfile, number> = {
  project: 8 * 60 * 60,
  user: 4 * 60 * 60,
  admin: 60 * 60,
};

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
    terminalEnabled: true,
    commands: [...lease.commands],
    createdAt: lease.createdAt,
    expiresAt: lease.expiresAt,
  };
}

export class AuthorityManager {
  private readonly leases = new Map<string, StoredLease>();
  private readonly now: () => number;
  private readonly homeDirInput: string;
  private readonly commands: string[];
  private readonly audit: ((event: AuthorityAuditEvent) => void | Promise<void>) | undefined;
  private auditChain: Promise<void> = Promise.resolve();

  constructor(options: AuthorityManagerOptions) {
    this.homeDirInput = options.homeDir;
    this.commands = [...new Set(options.commands)];
    this.now = options.now ?? Date.now;
    this.audit = options.audit;
  }

  async start(request: StartAuthorityRequest): Promise<AuthorityLeaseView> {
    const roots = await this.resolveRoots(request);
    const nowMs = this.now();
    const maxTtl = PROFILE_MAX_TTL_SECONDS[request.profile];
    const requestedTtl = request.requestedTtlSeconds ?? maxTtl;
    const ttlSeconds = Math.max(1, Math.min(requestedTtl, maxTtl));
    const expiresAtMs = nowMs + ttlSeconds * 1000;
    const leaseId = newLeaseId();

    const stored: StoredLease = {
      profile: request.profile,
      roots: [...roots],
      terminalEnabled: true,
      commands: [...this.commands],
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
    if (!stored) throw new AuthorityRequiredError();
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
    if (!stored) throw new AuthorityRequiredError();
    if (this.now() > stored.expiresAtMs) {
      this.leases.delete(key);
      this.emitAudit(stored, "authority.expired", false);
      throw new AuthorityExpiredError();
    }
    return stored;
  }

  private requireLeaseKey(leaseId: string): string {
    if (!leaseId.trim()) throw new AuthorityRequiredError();
    return digestLease(leaseId);
  }

  private emitAudit(
    lease: StoredLease,
    event: AuthorityAuditEvent["event"],
    includeExpiry: boolean,
  ): void {
    if (!this.audit) return;

    const record: AuthorityAuditEvent = {
      event,
      profile: lease.profile,
      rootCount: lease.roots.length,
      scopeDigest: digestScope(lease.roots),
      ...(includeExpiry ? { expiresAt: lease.expiresAt } : {}),
    };

    this.auditChain = this.auditChain.then(async () => {
      try {
        await this.audit?.(record);
      } catch {
        // Authority enforcement must remain fail-closed even if operational audit storage is unavailable.
      }
    });
  }

  private async resolveRoots(request: StartAuthorityRequest): Promise<string[]> {
    const home = await realpath(path.resolve(this.homeDirInput));
    const filesystemRoot = path.parse(home).root;

    if (request.profile === "user") return [home];
    if (request.profile === "admin") return [filesystemRoot];

    const requestedRoots = request.projectRoots?.map((root) => root.trim()).filter(Boolean) ?? [];
    if (requestedRoots.length === 0) {
      throw new AuthorityDeniedError("Project authority requires at least one explicit project root.");
    }

    const canonicalRoots: string[] = [];
    for (const requestedRoot of requestedRoots) {
      const canonical = await realpath(path.resolve(requestedRoot));
      const info = await stat(canonical);
      if (!info.isDirectory()) {
        throw new AuthorityDeniedError("Project authority roots must be directories.", { root: requestedRoot });
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
}
