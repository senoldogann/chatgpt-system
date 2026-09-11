import { z } from "zod";
import { COMPUTER_MAX_JS_OUTPUT_BYTES } from "./config.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const pathTypeSchema = z.enum(["directory", "file", "symlink", "other"]);
const nonNegativeInt = z.number().int().nonnegative();
const authorityProfileSchema = z.enum(["project", "user", "admin"]);
const authorityApprovalProfileSchema = z.enum(["user", "admin"]);
const authorityRequestStateSchema = z.enum([
  "pending",
  "approved",
  "denied",
  "cancelled",
  "failed",
  "expired",
  "consumed",
]);

export const systemCapabilitiesOutputSchema = z.object({
  roots: z.array(z.string()),
  auditFile: z.string(),
  terminal: z.object({
    enabled: z.boolean(),
    commands: z.array(z.string()),
  }),
  personalAdmin: z.object({
    enabled: z.boolean(),
    adminLeaseMaxTtlSeconds: z.literal(3600),
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

const authorityRequestBaseOutputSchema = z.object({
  requestId: z.string(),
  profile: authorityApprovalProfileSchema,
  state: authorityRequestStateSchema,
  requestedTtlSeconds: z.number().int().positive().optional(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const authorityRequestOutputSchema = authorityRequestBaseOutputSchema;

export const authorityRequestStatusOutputSchema = authorityRequestBaseOutputSchema.extend({
  lease: authorityLeaseOutputSchema.optional(),
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
  terminal: z.object({
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
});

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
  state: z.enum(["running", "exited", "stopped"]),
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
  stdout: processLogStreamOutputSchema,
  stderr: processLogStreamOutputSchema,
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

export const browserConsoleOutputSchema = z.object({
  pageId: browserPageIdSchema,
  entries: z.array(z.object({
    level: z.enum(["error", "warning"]),
    message: z.string(),
  })),
  truncated: z.boolean(),
});

export const browserNetworkOutputSchema = z.object({
  pageId: browserPageIdSchema,
  entries: z.array(z.object({
    method: z.string(),
    url: z.string(),
    status: z.number().int().optional(),
    failure: z.string().optional(),
  })),
  truncated: z.boolean(),
});

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

const computerElementOutputSchema = z.object({
  index: z.number().int().nonnegative(),
  role: z.string(),
  subrole: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  focused: z.boolean().optional(),
  enabled: z.boolean().optional(),
  selected: z.boolean().optional(),
  bounds: computerBoundsOutputSchema.optional(),
});

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
});

export const computerActionResultOutputSchema = z.object({
  state: z.string(),
  pointer: computerPointOutputSchema.optional(),
  changed: z.boolean().optional(),
});

export const computerChangedDigestOutputSchema = z.object({
  digest: z.string(),
});

export const computerScreenshotMetadataOutputSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

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
  })),
  finalObservation: z.union([
    computerActiveWindowOutputSchema,
    computerObservationOutputSchema,
  ]).optional(),
});
