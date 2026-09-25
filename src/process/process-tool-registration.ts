import type { RuntimeServices } from "../server.js";
import { DESTRUCTIVE, DESTRUCTIVE_IDEMPOTENT, READ_ONLY } from "../mcp/tool-annotations.js";
import {
  processListOutputSchema,
  processLogsOutputSchema,
  processSummaryOutputSchema,
  terminalResultOutputSchema,
} from "../mcp/tool-output-schemas.js";
import { safeCall } from "../mcp/tool-result.js";
import { authorityLeaseField, withAuthority } from "../mcp/tool-scope.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_PROCESS_WAIT_MS } from "./managed-process-service.js";

const processIdField = { processId: z.string().min(40) };
const waitField = { waitMs: z.number().int().min(0).max(MAX_PROCESS_WAIT_MS).optional() };

export function registerProcessTools(server: McpServer, runtime: RuntimeServices): void {
  server.registerTool(
    "terminal_run",
    {
      description: "Run an allowlisted executable with shell=false inside the active scope. It runs directly on the host without OS-level isolation.",
      inputSchema: z.object({
        ...authorityLeaseField,
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
      }),
      outputSchema: terminalResultOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async ({ authorityLeaseId, command, args, cwd }) => safeCall(() => withAuthority(runtime, authorityLeaseId).process.run(command, args, cwd)),
  );

  server.registerTool(
    "process_start",
    {
      description: "Start an allowlisted long-running child process with shell=false inside the active scope. Returns an opaque managed-process ID, never an OS PID.",
      inputSchema: z.object({
        ...authorityLeaseField,
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().default("."),
        idempotencyKey: z.string().min(1).max(256).optional(),
      }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async ({ authorityLeaseId, command, args, cwd, idempotencyKey }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.start(command, args, cwd, idempotencyKey)),
  );

  server.registerTool(
    "process_list",
    {
      description: "List managed processes visible to the active scope. Hidden or out-of-scope records are omitted.",
      inputSchema: z.object(authorityLeaseField).strict(),
      outputSchema: processListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.list()),
  );

  server.registerTool(
    "process_status",
    {
      description: "Read one manageable process state by opaque managed-process ID. Optional waitMs (up to 30000) waits server-side until the process stops running or the time elapses, so a long command needs fewer status calls. Unknown and unauthorized IDs return the same error.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField, ...waitField }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, processId, waitMs }, ctx) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.status(processId, {
      ...(waitMs !== undefined ? { waitMs } : {}),
      signal: ctx.mcpReq.signal,
    })),
  );

  server.registerTool(
    "process_logs",
    {
      description: "Read bounded stdout/stderr tails for one manageable process together with its current state and exit code. With cursor, returns only output after it; adding waitMs (up to 30000) waits server-side until new output arrives, the process stops running, or the time elapses. No log files or OS PID access are exposed.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField, cursor: z.number().int().nonnegative().optional(), ...waitField }).strict(),
      outputSchema: processLogsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, processId, cursor, waitMs }, ctx) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.logs(processId, cursor, {
      ...(waitMs !== undefined ? { waitMs } : {}),
      signal: ctx.mcpReq.signal,
    })),
  );

  server.registerTool(
    "process_stop",
    {
      description: "Idempotently stop one manageable process. The daemon chooses SIGTERM/grace/SIGKILL internally; callers cannot provide PIDs or signals.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: DESTRUCTIVE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, processId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.stop(processId)),
  );
}
