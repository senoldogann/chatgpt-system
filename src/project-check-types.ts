export type ProjectCheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "STALE" | "UNAVAILABLE";
export type ProjectCheckKind = "check" | "typecheck" | "lint" | "test" | "build";
export type ProjectCheckBaseStatus = Extract<ProjectCheckStatus, "PASS" | "FAIL" | "UNAVAILABLE">;

export interface DetectedProjectCheck {
  checkId: string;
  kind: ProjectCheckKind;
  command: string;
  args: string[];
  cwd: string;
  source: string;
}

export interface StoredProjectCheckEvidence extends DetectedProjectCheck {
  baseStatus: ProjectCheckBaseStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  head: string;
  workingTreeDigest: string;
  stdoutSha256: string;
  stderrSha256: string;
  stdoutBytes: number;
  stderrBytes: number;
  stateChangedDuringRun: boolean;
}

export interface StoredProjectVerification {
  version: 1;
  projectFingerprint: string;
  repositoryRoot: string;
  updatedAt: string;
  evidence: Record<string, StoredProjectCheckEvidence>;
}

export interface ProjectCheckViewItem extends DetectedProjectCheck {
  status: ProjectCheckStatus;
  evidence?: StoredProjectCheckEvidence;
  freshness?: {
    headMatches: boolean;
    workingTreeMatches: boolean;
  };
}

export interface ProjectCheckView {
  operation: "detect" | "run" | "report";
  repositoryRoot: string;
  required: boolean;
  overallStatus: ProjectCheckStatus;
  observed: {
    head: string;
    workingTreeDigest: string;
  };
  checks: ProjectCheckViewItem[];
}
