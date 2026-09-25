import type { RuntimeServices } from "./server.js";
import { DESTRUCTIVE, DESTRUCTIVE_IDEMPOTENT, READ_ONLY } from "./tool-annotations.js";
import {
  processListOutputSchema,
  processLogsOutputSchema,
  processSummaryOutputSchema,
  terminalResultOutputSchema,
} from "./tool-output-schemas.js";
import { safeCall } from "./tool-result.js";
import { authorityLeaseField, withAuthority } from "./tool-scope.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

const processIdField = { processId: z.string().min(40) };

export function registerProcessTools(server: McpServer, runtime: RuntimeServices): void {
  server.registerTool(
    "terminal_run",
    {
      description: "Run an allowlisted executable with shell=false inside the active scope. It is NOT an OS sandbox.",
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
      description: "Read one manageable process state by opaque managed-process ID. Unknown and unauthorized IDs return the same error.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField }).strict(),
      outputSchema: processSummaryOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, processId }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.status(processId)),
  );

  server.registerTool(
    "process_logs",
    {
      description: "Read bounded in-memory stdout/stderr tails for one manageable process. No log files or OS PID access are exposed.",
      inputSchema: z.object({ ...authorityLeaseField, ...processIdField, cursor: z.number().int().nonnegative().optional() }).strict(),
      outputSchema: processLogsOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, processId, cursor }) => safeCall(() => withAuthority(runtime, authorityLeaseId).processes.logs(processId, cursor)),
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
