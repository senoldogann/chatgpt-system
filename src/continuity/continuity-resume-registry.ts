import { createHash } from "node:crypto";
import { ProjectResumeRequiredError } from "../core/errors.js";

export interface ContinuityResumeContext {
  projectId: string;
  alias: string;
  recordVersion: number;
  canonicalWorktree: string;
  repositoryRoot: string;
  repositoryIdentity: string;
  expiresAt: string;
}

const MAX_RESUME_CONTEXTS = 256;

function leaseDigest(leaseId: string): string {
  if (!leaseId.trim()) throw new ProjectResumeRequiredError();
  return createHash("sha256").update(leaseId).digest("hex");
}

function cloneContext(context: ContinuityResumeContext): ContinuityResumeContext {
  return { ...context };
}

export class ContinuityResumeRegistry {
  private readonly records = new Map<string, ContinuityResumeContext>();

  register(leaseId: string, context: ContinuityResumeContext): void {
    const key = leaseDigest(leaseId);
    if (this.records.has(key)) this.records.delete(key);
    while (this.records.size >= MAX_RESUME_CONTEXTS) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
    this.records.set(key, cloneContext(context));
  }

  require(leaseId: string): ContinuityResumeContext {
    const context = this.records.get(leaseDigest(leaseId));
    if (!context) throw new ProjectResumeRequiredError();
    return cloneContext(context);
  }
}
