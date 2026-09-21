import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { AuditLogger } from "./audit.js";
import type { AppConfig } from "./config.js";
import { errorPayload } from "./errors.js";
import { WorkerStore, type WorkerRun } from "./worker-store.js";
import { workerRunOutputSchema } from "./tool-output-schemas.js";

export interface WorkerToolRuntime {
  audit: AuditLogger;
  config: AppConfig;
  taskStateRoot: string;
}

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function successResult<T extends object>(value: T) {
  return {
    ...textResult(value),
    structuredContent: value as Record<string, unknown>,
  };
}

async function safeCall<T extends object>(fn: () => Promise<T>) {
  try {
    return successResult(await fn());
  } catch (error) {
    return { ...textResult(errorPayload(error)), isError: true };
  }
}

async function storeFor(runtime: WorkerToolRuntime): Promise<WorkerStore> {
  return WorkerStore.open(
    runtime.taskStateRoot,
    runtime.audit,
    runtime.config.workers.maxWorkers,
    runtime.config.workers.maxParkedRuns,
  );
}

function publicRun(run: WorkerRun) {
  return {
    runId: run.runId,
    primeAlias: run.primeAlias,
    parked: run.parked,
    workers: run.workers.map((worker) => ({
      id: worker.id,
      label: worker.label,
      task: worker.task,
      state: worker.state,
      alias: worker.alias,
      worktreePath: worker.worktreePath,
      createdAt: worker.createdAt,
      lastSeenAt: worker.lastSeenAt,
      result: worker.result,
    })),
  };
}

const spawnSpecSchema = z.object({
  task: z.string().min(1).max(4_000),
  label: z.string().min(1).max(60).optional(),
  alias: z.string().min(1).max(128).optional(),
  worktreePath: z.string().min(1).max(16_384).optional(),
}).strict();

export function registerWorkerTools(server: McpServer, runtime: WorkerToolRuntime): void {
  server.registerTool(
    "worker_spawn",
    {
      description: "Start one worker run for a prime project alias with 1-8 workers. Each worker gets the shared context plus its own task. Worker chats are separate project aliases or worktrees; no browser tabs are opened. No lease required.",
      inputSchema: z.object({
        primeAlias: z.string().min(1).max(128),
        sharedContext: z.string().max(4_000).default(""),
        workers: z.array(spawnSpecSchema).min(1).max(8),
      }).strict(),
      outputSchema: workerRunOutputSchema,
      annotations,
    },
    async ({ primeAlias, sharedContext, workers }) => safeCall(async () => publicRun(
      await (await storeFor(runtime)).spawn(primeAlias, sharedContext, workers.map((spec) => ({
        task: spec.task,
        ...(spec.label !== undefined ? { label: spec.label } : {}),
        ...(spec.alias !== undefined ? { alias: spec.alias } : {}),
        ...(spec.worktreePath !== undefined ? { worktreePath: spec.worktreePath } : {}),
      }))),
    )),
  );

  server.registerTool(
    "worker_status",
    {
      description: "Read one worker run with inbox notes, states and finish reports. No lease required.",
      inputSchema: z.object({ runId: z.string().min(1).max(128) }).strict(),
      outputSchema: workerRunOutputSchema,
      annotations: readAnnotations,
    },
    async ({ runId }) => safeCall(async () => publicRun(await (await storeFor(runtime)).status(runId))),
  );

  server.registerTool(
    "worker_message",
    {
      description: "Append a bounded note to one worker's inbox. A sleeping worker wakes to active. Terminal workers refuse. No lease required.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        workerId: z.string().min(1).max(64),
        message: z.string().min(1).max(4_000),
      }).strict(),
      outputSchema: workerRunOutputSchema,
      annotations,
    },
    async ({ runId, workerId, message }) => safeCall(async () => publicRun(
      await (await storeFor(runtime)).message(runId, workerId, message),
    )),
  );

  server.registerTool(
    "worker_sleep",
    {
      description: "Park one worker as sleeping without losing its task, notes or alias binding. No lease required.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        workerId: z.string().min(1).max(64),
      }).strict(),
      outputSchema: workerRunOutputSchema,
      annotations,
    },
    async ({ runId, workerId }) => safeCall(async () => publicRun(
      await (await storeFor(runtime)).sleep(runId, workerId),
    )),
  );

  server.registerTool(
    "worker_finish",
    {
      description: "Close one worker with its final report. When every worker of the run is terminal, the run parks as retained history. No lease required.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        workerId: z.string().min(1).max(64),
        report: z.string().min(1).max(4_000),
        failed: z.boolean().default(false),
      }).strict(),
      outputSchema: workerRunOutputSchema,
      annotations,
    },
    async ({ runId, workerId, report, failed }) => safeCall(async () => publicRun(
      await (await storeFor(runtime)).finish(runId, workerId, report, failed),
    )),
  );
}
