import { createHash, randomBytes } from "node:crypto";
import {
  LocalApprovalExpiredError,
  LocalApprovalInvalidError,
} from "./errors.js";

export type AuthorityApprovalProfile = "user" | "admin";
export type AuthorityRequestState =
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "failed"
  | "expired"
  | "consumed";

export type AuthorityRequestAuditEventName =
  | "authority.request.created"
  | "authority.request.completed"
  | "authority.request.expired"
  | "authority.request.consumed";

export interface AuthorityRequestAuditEvent {
  event: AuthorityRequestAuditEventName;
  profile: AuthorityApprovalProfile;
  state: AuthorityRequestState;
  requestedTtlSeconds?: number;
  expiresAt?: string;
}

export interface CreateAuthorityRequest {
  profile: AuthorityApprovalProfile;
  requestedTtlSeconds?: number;
}

export interface AuthorityRequestView {
  requestId: string;
  profile: AuthorityApprovalProfile;
  state: AuthorityRequestState;
  requestedTtlSeconds?: number;
  createdAt: string;
  expiresAt: string;
}

export interface AuthorityRequestManagerOptions {
  now?: () => number;
  audit?: (event: AuthorityRequestAuditEvent) => void | Promise<void>;
}

interface StoredAuthorityRequest {
  profile: AuthorityApprovalProfile;
  state: AuthorityRequestState;
  requestedTtlSeconds?: number;
  createdAt: string;
  expiresAt: string;
  expiresAtMs: number;
}

const APPROVAL_REQUEST_TTL_SECONDS = 120;

function newRequestId(): string {
  return randomBytes(32).toString("base64url");
}

function digestRequestId(requestId: string): string {
  return createHash("sha256").update(requestId).digest("hex");
}

function cloneView(requestId: string, stored: StoredAuthorityRequest): AuthorityRequestView {
  return {
    requestId,
    profile: stored.profile,
    state: stored.state,
    ...(stored.requestedTtlSeconds !== undefined
      ? { requestedTtlSeconds: stored.requestedTtlSeconds }
      : {}),
    createdAt: stored.createdAt,
    expiresAt: stored.expiresAt,
  };
}

export class AuthorityRequestManager {
  private readonly requests = new Map<string, StoredAuthorityRequest>();
  private readonly now: () => number;
  private readonly audit: ((event: AuthorityRequestAuditEvent) => void | Promise<void>) | undefined;
  private auditChain: Promise<void> = Promise.resolve();

  constructor(options: AuthorityRequestManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.audit = options.audit;
  }

  create(input: CreateAuthorityRequest): AuthorityRequestView {
    const nowMs = this.now();
    const expiresAtMs = nowMs + APPROVAL_REQUEST_TTL_SECONDS * 1000;
    const requestId = newRequestId();
    const stored: StoredAuthorityRequest = {
      profile: input.profile,
      state: "pending",
      ...(input.requestedTtlSeconds !== undefined
        ? { requestedTtlSeconds: input.requestedTtlSeconds }
        : {}),
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
    };

    this.requests.set(digestRequestId(requestId), stored);
    this.emitAudit(stored, "authority.request.created");
    return cloneView(requestId, stored);
  }

  resolve(requestId: string): AuthorityRequestView {
    const stored = this.lookup(requestId);
    return cloneView(requestId, stored);
  }

  complete(
    requestId: string,
    state: Extract<AuthorityRequestState, "approved" | "denied" | "cancelled" | "failed">,
  ): AuthorityRequestView {
    const key = this.requireKey(requestId);
    const stored = this.requests.get(key);
    if (!stored) throw new LocalApprovalInvalidError();
    if (this.now() > stored.expiresAtMs) {
      this.expire(key, stored);
      throw new LocalApprovalExpiredError();
    }
    if (stored.state !== "pending") throw new LocalApprovalInvalidError();

    stored.state = state;
    this.emitAudit(stored, "authority.request.completed");
    return cloneView(requestId, stored);
  }

  consumeApproved(requestId: string): AuthorityRequestView {
    const key = this.requireKey(requestId);
    const stored = this.requests.get(key);
    if (!stored) throw new LocalApprovalInvalidError();
    if (this.now() > stored.expiresAtMs) {
      this.expire(key, stored);
      throw new LocalApprovalExpiredError();
    }
    if (stored.state !== "approved") throw new LocalApprovalInvalidError();

    stored.state = "consumed";
    this.emitAudit(stored, "authority.request.consumed");
    return cloneView(requestId, stored);
  }

  async flushAudit(): Promise<void> {
    await this.auditChain;
  }

  private lookup(requestId: string): StoredAuthorityRequest {
    const key = this.requireKey(requestId);
    const stored = this.requests.get(key);
    if (!stored) throw new LocalApprovalInvalidError();
    if (this.now() > stored.expiresAtMs) {
      this.expire(key, stored);
      throw new LocalApprovalExpiredError();
    }
    return stored;
  }

  private expire(key: string, stored: StoredAuthorityRequest): void {
    stored.state = "expired";
    this.emitAudit(stored, "authority.request.expired");
    this.requests.delete(key);
  }

  private emitAudit(stored: StoredAuthorityRequest, event: AuthorityRequestAuditEventName): void {
    if (!this.audit) return;
    const record: AuthorityRequestAuditEvent = {
      event,
      profile: stored.profile,
      state: stored.state,
      ...(stored.requestedTtlSeconds !== undefined
        ? { requestedTtlSeconds: stored.requestedTtlSeconds }
        : {}),
      ...(event === "authority.request.created" ? { expiresAt: stored.expiresAt } : {}),
    };
    this.auditChain = this.auditChain.then(async () => {
      try {
        await this.audit?.(record);
      } catch {
        // Approval enforcement never depends on audit storage availability.
      }
    });
  }

  private requireKey(requestId: string): string {
    if (!requestId.trim()) throw new LocalApprovalInvalidError();
    return digestRequestId(requestId);
  }
}
