import { z } from "zod";
import { COMPUTER_MAX_JS_OUTPUT_BYTES, COMPUTER_MAX_RUN_STEP_RESULTS } from "./config.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pathTypeSchema = z.enum(["directory", "file", "symlink", "other"]);
const nonNegativeInt = z.number().int().nonnegative();
const authorityProfileSchema = z.literal("project");

const projectAuthoritySemanticsOutputSchema = z.object({
  bootstrapRootsAreDefaultsOnly: z.literal(true),
  dynamicProjectRootsSupported: z.literal(true),
  forbiddenBroadRoots: z.tuple([z.literal("filesystem-root"), z.literal("home-directory")]),
  recommendedOpenFlow: z.tuple([
    z.literal("session_authority_start"),
    z.literal("project_register"),
    z.literal("project_resume"),
  ]),
}).strict();

export const systemCapabilitiesOutputSchema = z.object({
  roots: z.array(z.string()),
  projectAuthority: projectAuthoritySemanticsOutputSchema,
  auditFile: z.string(),
  terminal: z.object({
    enabled: z.boolean(),
    commands: z.array(z.string()),
  }),
  ownerRuntime: z.object({
    enabled: z.boolean(),
  }),
  skills: z.object({
    enabled: z.boolean(),
  }),
  goal: z.object({
    enabled: z.boolean(),
  }),
  workers: z.object({
    enabled: z.boolean(),
    maxWorkers: z.number().int().positive(),
  }),
  computerUse: z.object({
    enabled: z.boolean(),
    fullHostJsEnabled: z.boolean(),
  }),
  projectExecution: z.object({
    enabled: z.boolean(),
    sandboxed: z.literal(true),
    backend: z.literal("docker"),
    network: z.literal("none"),
    hostFallback: z.literal(false),
    image: z.string(),
  }),
  limits: z.object({
    maxReadBytes: z.number().int().positive(),
    maxWriteBytes: z.number().int().positive(),
    maxDirectoryEntries: z.number().int().positive(),
    maxCommandOutputBytes: z.number().int().positive(),
    commandTimeoutMs: z.number().int().positive(),
    maxManagedProcesses: z.number().int().positive(),
    maxProcessLogBytesPerStream: z.number().int().positive(),
    processStopGraceMs: z.number().int().positive(),
  }),
  safety: z.object({
    filesystemConfinement: z.literal(true),
    symlinkEscapeProtection: z.literal(true),
    writeConflictProtection: z.literal("optimistic-sha256"),
    atomicFileReplacement: z.literal(true),
    linearizableExternalWriterCAS: z.literal(false),
    hostileLocalFilesystemRaceProtection: z.literal(false),
    terminalOsSandboxed: z.literal(false),
  }),
});

export const authorityLeaseOutputSchema = z.object({
  leaseId: z.string(),
  profile: authorityProfileSchema,
  roots: z.array(z.string()),
  terminalEnabled: z.boolean(),
  commands: z.array(z.string()),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const authorityEndOutputSchema = z.object({
  ended: z.literal(true),
});

export const executableResolutionOutputSchema = z.object({
  name: z.string(),
  allowed: z.boolean(),
  available: z.boolean(),
  resolvedPath: z.string().nullable(),
});

export const systemEnvironmentOutputSchema = z.object({
  os: z.string(),
  platform: z.string(),
  arch: z.string(),
  pathEntries: z.array(z.string()),
  roots: z.array(z.string()),
  projectAuthority: projectAuthoritySemanticsOutputSchema,
  terminal: z.object({
    enabled: z.boolean(),
  }),
  ownerRuntime: z.object({
    enabled: z.boolean(),
  }),
  computerUse: z.object({
    enabled: z.boolean(),
    fullHostJsEnabled: z.boolean(),
  }),
  executables: z.array(executableResolutionOutputSchema),
});

export const fsListOutputSchema = z.object({
  path: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    type: pathTypeSchema,
  })),
});

export const fsStatOutputSchema = z.object({
  path: z.string(),
  type: pathTypeSchema,
  size: nonNegativeInt,
  mode: z.string().regex(/^0[0-7]{1,3}$/),
  modifiedAt: z.string(),
  sha256: sha256Schema.optional(),
});

export const fsReadOutputSchema = z.object({
  path: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  content: z.string(),
  bytes: nonNegativeInt,
  sha256: sha256Schema,
});

export const fsWriteOutputSchema = z.object({
  path: z.string(),
  bytes: nonNegativeInt,
  sha256: sha256Schema,
  created: z.boolean(),
});

export const fsPatchOutputSchema = z.object({
  path: z.string(),
  bytes: nonNegativeInt,
  sha256: sha256Schema,
  // Yedekli `@@` satır sayıları gövdeden düzeltildiyse çağırana açıkça bildirilir.
  normalizedHunkHeaders: z.boolean(),
});

export const fsPatchSetOutputSchema = z.object({
  recoveredTransactions: nonNegativeInt,
  applied: z.array(z.object({
    path: z.string(),
    bytes: nonNegativeInt,
    sha256: sha256Schema,
  }).strict()),
}).strict();

export const fsMkdirOutputSchema = z.object({
  path: z.string(),
  created: z.boolean(),
});

export const fsMoveOutputSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const fsRemoveOutputSchema = z.object({
  path: z.string(),
  removed: z.literal(true),
});

export const gitResultOutputSchema = z.object({
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export const gitInventoryOutputSchema = z.object({
  cwd: z.string(),
  entries: z.array(z.object({
    path: z.string(),
    category: z.enum(["modified", "untracked", "deleted", "ignored"]),
    risk: z.enum(["none", "secret", "binary", "artifact"]),
    indexStatus: z.string().optional(),
    worktreeStatus: z.string().optional(),
  }).strict()),
  cursor: z.number().int().nonnegative(),
  snapshot: sha256Schema,
  nextCursor: z.number().int().nonnegative().optional(),
  complete: z.boolean(),
}).strict();

export const gitFileReviewOutputSchema = z.object({
  cwd: z.string(),
  path: z.string(),
  diff: z.string(),  diffBytes: nonNegativeInt,
  diffSha256: sha256Schema,
  contentSha256: sha256Schema.nullable(),
  deletion: z.boolean(),
  deletionEvidence: z.enum(["worktree-path-missing", "not-deleted"]),
  risk: z.enum(["none", "secret", "binary", "artifact"]),
  contentEncoding: z.enum(["utf8", "base64"]),
}).strict();

export const gitWorktreeOutputSchema = z.object({
  operation: z.enum(["create", "status", "remove"]),
  worktreeId: z.string().uuid(),
  path: z.string(),
  repositoryRoot: z.string(),
  branch: z.string(),
  head: z.string().regex(/^[a-f0-9]{40,64}$/i),
  dirty: z.boolean(),
  removed: z.boolean(),
}).strict();

const projectCheckStatusSchema = z.enum(["PASS", "FAIL", "NOT_RUN", "STALE", "UNAVAILABLE"]);
const projectCheckKindSchema = z.enum(["check", "typecheck", "lint", "test", "build"]);
const projectCheckExecutionSchema = z.enum(["project-sandbox", "admin-host"]);
const projectCheckCommonFields = {
  checkId: z.string(),
  kind: projectCheckKindSchema,
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  source: z.string(),
};
const projectCheckDetectedFields = {
  ...projectCheckCommonFields,
  execution: projectCheckExecutionSchema,
};
const projectCheckEvidenceSchema = z.object({
  ...projectCheckCommonFields,
  execution: projectCheckExecutionSchema.optional(),
  baseStatus: z.enum(["PASS", "FAIL", "UNAVAILABLE"]),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: nonNegativeInt,
  exitCode: z.number().int().nullable(),
  head: z.string().regex(/^[a-f0-9]{40,64}$/i),
  workingTreeDigest: sha256Schema,
  stdoutSha256: sha256Schema,
  stderrSha256: sha256Schema,
  stdoutBytes: nonNegativeInt,
  stderrBytes: nonNegativeInt,
  stateChangedDuringRun: z.boolean(),
}).strict();
const projectCheckItemSchema = z.object({
  ...projectCheckDetectedFields,
  status: projectCheckStatusSchema,
  evidence: projectCheckEvidenceSchema.optional(),
  freshness: z.object({
    headMatches: z.boolean(),
    workingTreeMatches: z.boolean(),
  }).strict().optional(),
}).strict();

export const projectCheckOutputSchema = z.object({
  operation: z.enum(["detect", "run", "report"]),
  repositoryRoot: z.string(),
  required: z.boolean(),
  overallStatus: projectCheckStatusSchema,
  observed: z.object({
    head: z.string().regex(/^[a-f0-9]{40,64}$/i),
    workingTreeDigest: sha256Schema,
  }).strict(),
  checks: z.array(projectCheckItemSchema),
}).strict();

export const shellRunOutputSchema = z.object({
  cwd: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  stdoutBytesSeen: nonNegativeInt,
  stderrBytesSeen: nonNegativeInt,
  stdoutTruncated: z.boolean(),
  stderrTruncated: z.boolean(),
  timedOut: z.boolean(),
}).strict();

export const terminalResultOutputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
});

const terminalSessionStateSchema = z.enum(["running", "exited", "stopped"]);

export const terminalSessionSummaryOutputSchema = z.object({
  sessionId: z.string().min(40).max(128),
  cwd: z.string(),
  state: terminalSessionStateSchema,
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
  startedAt: z.string(),
  exitedAt: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.number().int().nullable().optional(),
  outputSequence: nonNegativeInt,
}).strict();

export const terminalSessionReadOutputSchema = z.object({
  sessionId: z.string().min(40).max(128),
  state: terminalSessionStateSchema,
  data: z.string(),
  bytes: nonNegativeInt,
  nextSequence: nonNegativeInt,
  truncatedBefore: z.boolean(),
}).strict();

export const terminalSessionListOutputSchema = z.object({
  sessions: z.array(terminalSessionSummaryOutputSchema),
}).strict();

const codeQuerySearchResultSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string(),
  sha256: sha256Schema,
}).strict();

const codeQuerySymbolResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["variable", "function", "class", "interface", "type", "enum"]),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();

const codeQueryLocationResultSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();

const codeQueryReferenceResultSchema = codeQueryLocationResultSchema.extend({
  isDefinition: z.boolean(),
}).strict();

const codeQueryDiagnosticResultSchema = codeQueryLocationResultSchema.extend({
  severity: z.enum(["error", "warning", "suggestion", "message"]),
  code: z.number().int(),
  message: z.string(),
}).strict();

export const codeQueryOutputSchema = z.object({
  operation: z.enum(["search", "symbols", "definition", "references", "diagnostics"]),
  repositoryRoot: z.string(),
  results: z.array(z.union([
    codeQuerySearchResultSchema,
    codeQuerySymbolResultSchema,
    codeQueryReferenceResultSchema,
    codeQueryDiagnosticResultSchema,
    codeQueryLocationResultSchema,
  ])),
  truncated: z.boolean(),
  scannedFiles: nonNegativeInt,
  bytesScanned: nonNegativeInt,
}).strict();

const taskStateCheckpointOutputSchema = z.object({
  revision: z.number().int().positive(),
  summary: z.string(),
  findings: z.array(z.string()),
  decisions: z.array(z.string()),
  inspectedFiles: z.array(z.string()),
  modifiedFiles: z.array(z.string()),
  nextStep: z.string().optional(),
  evidenceRefs: z.array(z.string()),
  head: z.string(),
  workingTreeDigest: sha256Schema,
  createdAt: z.string(),
}).strict();

const taskStateOutcomeOutputSchema = z.object({
  status: z.enum(["completed", "failed"]),
  summary: z.string(),
  evidenceRefs: z.array(z.string()),
  head: z.string(),
  workingTreeDigest: sha256Schema,
  createdAt: z.string(),
}).strict();

export const taskStateOutputSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["active", "completed", "failed"]),
  revision: z.number().int().positive(),
  goal: z.string(),
  repositoryRoot: z.string(),
  projectFingerprint: sha256Schema,
  baseHead: z.string(),
  currentHead: z.string(),
  workingTreeDigest: sha256Schema,
  nextStep: z.string().optional(),
  checkpoints: z.array(taskStateCheckpointOutputSchema),
  outcome: taskStateOutcomeOutputSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  checkpointCount: nonNegativeInt,
  observed: z.object({
    head: z.string(),
    workingTreeDigest: sha256Schema,
  }).strict(),
  freshness: z.object({
    fresh: z.boolean(),
    headMatches: z.boolean(),
    workingTreeMatches: z.boolean(),
  }).strict(),
}).strict();

export const projectExecResultOutputSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  timedOut: z.boolean(),
  sandbox: z.object({
    backend: z.literal("docker"),
    network: z.literal("none"),
    hostFallback: z.literal(false),
  }),
}).strict();

export const processSummaryOutputSchema = z.object({
  processId: z.string(),
  command: z.string(),
  argCount: nonNegativeInt,
  cwd: z.string(),
  state: z.enum(["running", "stopping", "exited", "stopped", "unknown"]),
  jobId: z.string(),
  status: z.enum(["running", "stopping", "completed", "failed", "cancelled", "unknown"]),
  startedAt: z.string(),
  exitedAt: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
});

export const processListOutputSchema = z.object({
  processes: z.array(processSummaryOutputSchema),
});

const processLogStreamOutputSchema = z.object({
  content: z.string(),
  bytes: nonNegativeInt,
  truncated: z.boolean(),
});

export const processLogsOutputSchema = z.object({
  processId: z.string(),
  cursor: z.number().int().nonnegative().optional(),
  stdout: processLogStreamOutputSchema.extend({ nextCursor: z.number().int().nonnegative().optional() }),
  stderr: processLogStreamOutputSchema.extend({ nextCursor: z.number().int().nonnegative().optional() }),
});

const browserPageIdSchema = z.string().min(40).max(128);
const browserTabSchema = z.object({
  pageId: browserPageIdSchema,
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
});

export const browserHealthOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(["disabled", "stopped", "running", "unavailable"]),
  browserInstalled: z.boolean(),
});

export const browserTabsOutputSchema = z.object({
  tabs: z.array(browserTabSchema),
});

export const browserTabOutputSchema = browserTabSchema;

export const browserCloseTabOutputSchema = z.object({
  closed: z.literal(true),
});

export const browserSnapshotOutputSchema = z.object({
  pageId: browserPageIdSchema,
  snapshot: z.string(),
});

export const browserActionOutputSchema = z.object({
  ok: z.literal(true),
});

export const browserWaitOutputSchema = z.object({
  found: z.literal(true),
});

export const browserScreenshotMetadataOutputSchema = z.object({
  pageId: browserPageIdSchema,
  width: nonNegativeInt,
  height: nonNegativeInt,
});

const browserDiagnosticEvidenceOutputSchema = z.object({
  generation: nonNegativeInt,
  sequence: z.number().int().positive(),
}).strict();

export const browserConsoleOutputSchema = z.object({
  pageId: browserPageIdSchema,
  generation: nonNegativeInt,
  latestSequence: nonNegativeInt,
  entries: z.array(z.object({
    level: z.enum(["error", "warning"]),
    message: z.string(),
    evidence: browserDiagnosticEvidenceOutputSchema,
    runtimeSource: z.object({
      url: z.string(),
      lineNumber: nonNegativeInt.optional(),
      columnNumber: nonNegativeInt.optional(),
      sourceMapStatus: z.literal("UNAVAILABLE"),
    }).strict().optional(),
  }).strict()),
  truncated: z.boolean(),
}).strict();

export const browserNetworkOutputSchema = z.object({
  pageId: browserPageIdSchema,
  generation: nonNegativeInt,
  latestSequence: nonNegativeInt,
  entries: z.array(z.object({
    method: z.string(),
    url: z.string(),
    status: z.number().int().optional(),
    failure: z.string().optional(),
    evidence: browserDiagnosticEvidenceOutputSchema,
    requestId: z.string().min(16).max(128),
    resourceType: z.string().min(1).max(128),
    navigationRequest: z.boolean(),
    initiator: z.object({
      kind: z.literal("frame"),
      url: z.string(),
    }).strict().optional(),
  }).strict()),
  truncated: z.boolean(),
}).strict();

export const browserCloseOutputSchema = z.object({
  closed: z.literal(true),
});


const computerApplicationOutputSchema = z.object({
  name: z.string(),
  bundleIdentifier: z.string().optional(),
  frontmost: z.boolean(),
});

const computerPointOutputSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const computerBoundsOutputSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

const computerScrollCapabilityOutputSchema = z.object({
  scrollable: z.boolean(),
  axes: z.array(z.enum(["vertical", "horizontal"])).max(2),
}).strict();

const computerElementOutputSchema = z.object({
  index: z.number().int().nonnegative(),
  parentIndex: z.number().int().nonnegative().nullable(),
  depth: z.number().int().nonnegative(),
  role: z.string(),
  subrole: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  focused: z.boolean().optional(),
  enabled: z.boolean().optional(),
  selected: z.boolean().optional(),
  bounds: computerBoundsOutputSchema.optional(),
  actions: z.array(z.string().max(128)).max(16),
  scroll: computerScrollCapabilityOutputSchema,
}).strict();

const computerOcrCandidateOutputSchema = z.object({
  text: z.string().max(512),
  bounds: computerBoundsOutputSchema,
  confidence: z.number().min(0).max(1).nullable(),
  source: z.enum(["vision-fast", "vision-accurate"]),
}).strict();

const computerPerceptionOutputSchema = z.object({
  axQuality: z.enum(["strong", "partial", "weak"]),
  webContentAccessible: z.boolean().nullable(),
  ocrUsed: z.boolean(),
  recommendedTargeting: z.enum(["ax", "ocr", "visual-point"]),
  ocrCandidates: z.array(computerOcrCandidateOutputSchema).max(64),
}).strict();

export const computerHealthOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(["disabled", "stopped", "running", "unavailable"]),
  accessibilityTrusted: z.boolean(),
  screenCaptureAuthorized: z.boolean(),
  eventListenAuthorized: z.boolean(),
  eventPostAuthorized: z.boolean(),
  fullHostJsEnabled: z.boolean(),
});

export const computerPointResultOutputSchema = computerPointOutputSchema;

export const computerApplicationResultOutputSchema = computerApplicationOutputSchema;

export const computerActiveWindowOutputSchema = z.object({
  application: computerApplicationOutputSchema,
  title: z.string().optional(),
});

export const computerObservationOutputSchema = z.object({
  snapshotId: z.string(),
  application: computerApplicationOutputSchema,
  windowTitle: z.string().optional(),
  elements: z.array(computerElementOutputSchema),
  truncated: z.boolean(),
  digest: z.string().optional(),
  perception: computerPerceptionOutputSchema,
}).strict();

export const computerSemanticTargetResolutionOutputSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("resolved"),
    target: z.object({
      by: z.literal("index"),
      snapshotId: z.string(),
      index: z.number().int().nonnegative(),
    }).strict(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  z.object({
    outcome: z.literal("unresolved"),
    reason: z.enum(["no_match", "low_confidence", "ambiguous_duplicate"]),
    confidence: z.number().min(0).max(1),
  }).strict(),
]);

export const computerActionResultOutputSchema = z.object({
  state: z.enum(["verified", "completed_unverified"]),
  pointer: computerPointOutputSchema.optional(),
  changed: z.boolean().optional(),
  verification: z.object({
    kind: z.enum(["ax", "text", "screen-region", "none"]),
    changed: z.boolean().nullable(),
  }).strict().optional(),
}).strict();

export const computerScrollUntilVisibleOutputSchema = z.object({
  state: z.enum(["target_visible", "boundary_reached", "needs_replan"]),
  stepsUsed: z.number().int().min(0).max(6),
  changed: z.boolean(),
}).strict();

export const computerWaitResultOutputSchema = z.object({
  state: z.literal("completed"),
}).strict();

export const computerChangedDigestOutputSchema = z.object({
  digest: z.string(),
});

export const computerScreenshotMetadataOutputSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  captureKind: z.literal("display"),
  screenBounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).strict(),
  scaleX: z.number().positive(),
  scaleY: z.number().positive(),
}).strict();

const computerRunStepTypeSchema = z.enum([
  "observe",
  "pointer_position",
  "open_app",
  "focus_app",
  "move_mouse",
  "click",
  "double_click",
  "mouse_down",
  "mouse_up",
  "drag",
  "scroll",
  "type_text",
  "press_key",
  "wait",
  "wait_for_frontmost",
  "wait_for_text",
  "wait_until_changed",
  "release_inputs",
]);

export const computerJsRunOutputSchema = z.object({
  stdout: z.string().max(COMPUTER_MAX_JS_OUTPUT_BYTES),
  stderr: z.string().max(COMPUTER_MAX_JS_OUTPUT_BYTES),
  result: z.unknown().optional(),
}).strict();

export const computerRunOutputSchema = z.object({
  state: z.enum(["completed", "completed_unverified"]),
  completedCount: z.number().int().nonnegative(),
  actionCount: z.number().int().nonnegative(),
  steps: z.array(z.object({
    index: z.number().int().nonnegative(),
    type: computerRunStepTypeSchema,
    state: z.literal("completed"),
  }).strict()).max(COMPUTER_MAX_RUN_STEP_RESULTS),
  stepsTruncated: z.boolean(),
  finalObservation: z.union([
    computerActiveWindowOutputSchema,
    computerObservationOutputSchema,
  ]).optional(),
});

export const skillSummaryOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  path: z.string(),
}).strict();

export const skillListOutputSchema = z.object({
  skills: z.array(skillSummaryOutputSchema),
}).strict();

export const skillReadOutputSchema = z.object({
  summary: skillSummaryOutputSchema,
  text: z.string(),
}).strict();

export const goalAdviseOutputSchema = z.object({
  action: z.enum(["stop", "continue"]),
  reply: z.string(),
  reason: z.string(),
}).strict();

export const workerMessageOutputSchema = z.object({
  id: z.string(),
  from: z.enum(["prime", "worker"]),
  text: z.string(),
  sentAt: z.string(),
  readAt: z.string().nullable(),
}).strict();

export const workerInfoOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  task: z.string(),
  state: z.enum(["active", "sleeping", "finished", "failed"]),
  alias: z.string().nullable(),
  worktreePath: z.string().nullable(),
  inbox: z.array(workerMessageOutputSchema),
  inboxTotal: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  result: z.string().nullable(),
}).strict();

export const workerRunOutputSchema = z.object({
  runId: z.string(),
  primeAlias: z.string(),
  workers: z.array(workerInfoOutputSchema),
  parked: z.boolean(),
}).strict();

export const handoffPrepareOutputSchema = z.object({
  brief: z.string(),
  bootstrap: z.string(),
  truncated: z.boolean(),
  llmDrafted: z.boolean(),
}).strict();
