export type TaskStateStatus = "active" | "completed" | "failed";
export type TaskStateTerminalStatus = Exclude<TaskStateStatus, "active">;

export interface TaskStateCheckpoint {
  revision: number;
  summary: string;
  findings: string[];
  decisions: string[];
  inspectedFiles: string[];
  modifiedFiles: string[];
  nextStep?: string;
  evidenceRefs: string[];
  head: string;
  workingTreeDigest: string;
  createdAt: string;
}

export interface TaskStateOutcome {
  status: TaskStateTerminalStatus;
  summary: string;
  evidenceRefs: string[];
  head: string;
  workingTreeDigest: string;
  createdAt: string;
}

export interface StoredTaskState {
  taskId: string;
  status: TaskStateStatus;
  revision: number;
  goal: string;
  repositoryRoot: string;
  projectFingerprint: string;
  baseHead: string;
  currentHead: string;
  workingTreeDigest: string;
  nextStep?: string;
  checkpoints: TaskStateCheckpoint[];
  outcome?: TaskStateOutcome;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryStateObservation {
  repositoryRoot: string;
  projectFingerprint: string;
  head: string;
  workingTreeDigest: string;
}

export interface TaskStateView extends StoredTaskState {
  checkpointCount: number;
  observed: {
    head: string;
    workingTreeDigest: string;
  };
  freshness: {
    fresh: boolean;
    headMatches: boolean;
    workingTreeMatches: boolean;
  };
}

export interface TaskCheckpointInput {
  summary: string;
  findings?: string[];
  decisions?: string[];
  inspectedFiles?: string[];
  modifiedFiles?: string[];
  nextStep?: string;
  evidenceRefs?: string[];
}
