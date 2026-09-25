import type { RuntimeServices } from "../server.js";
import { DESTRUCTIVE, DESTRUCTIVE_IDEMPOTENT, READ_ONLY, WRITE_IDEMPOTENT } from "../mcp/tool-annotations.js";
import {
  fsListOutputSchema,
  fsMkdirOutputSchema,
  fsMoveOutputSchema,
  fsPatchOutputSchema,
  fsEditOutputSchema,
  fsReadManyOutputSchema,
  fsReadOutputSchema,
  fsRemoveOutputSchema,
  fsStatOutputSchema,
  fsWriteOutputSchema,
} from "../mcp/tool-output-schemas.js";
import { safeCall } from "../mcp/tool-result.js";
import { authorityLeaseField, withAuthority } from "../mcp/tool-scope.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export function registerFileSystemTools(server: McpServer, runtime: RuntimeServices): void {
  server.registerTool(
    "fs_list",
    {
      description: "List one directory inside the active authority lease scope without following directory entries.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string().default(".") }),
      outputSchema: fsListOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, path }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.list(path)),
  );

  server.registerTool(
    "fs_stat",
    {
      description: "Inspect a path inside the active authority lease scope. Small regular files include a SHA-256 hash for conflict-safe writes.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string() }),
      outputSchema: fsStatOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, path }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.stat(path)),
  );

  server.registerTool(
    "fs_read",
    {
      description: "Read a regular file inside the active authority lease scope and return its content plus the SHA-256 of the whole file. Optional offset (1-based line) and limit (line count) return only that line range with range.totalLines, for large files. The hash can guard later fs_edit/fs_write/fs_apply_patch calls.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
        offset: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      outputSchema: fsReadOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, path, encoding, offset, limit }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.read(path, encoding, {
      ...(offset !== undefined ? { offset } : {}),
      ...(limit !== undefined ? { limit } : {}),
    })),
  );

  server.registerTool(
    "fs_read_many",
    {
      description: "Read 1-20 UTF-8 files in one call, each optionally limited to a 1-based line range (offset/limit). Each entry returns content with the whole-file SHA-256, or an error for that file only. Total returned content is bounded by the single-file read limit.",
      inputSchema: z.object({
        ...authorityLeaseField,
        files: z.array(z.object({
          path: z.string(),
          offset: z.number().int().positive().optional(),
          limit: z.number().int().positive().optional(),
        }).strict()).min(1).max(20),
      }).strict(),
      outputSchema: fsReadManyOutputSchema,
      annotations: READ_ONLY,
    },
    async ({ authorityLeaseId, files }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.readMany(files.map((file) => ({
      path: file.path,
      ...(file.offset !== undefined ? { offset: file.offset } : {}),
      ...(file.limit !== undefined ? { limit: file.limit } : {}),
    })))),
  );

  server.registerTool(
    "fs_edit",
    {
      description: "Edit an existing UTF-8 file by exact string replacement: oldString must match the current text exactly once (including whitespace), or every occurrence when replaceAll is true. Fails without writing when there is no match or more than one match. Optional expectedSha256 guards against concurrent changes. Returns the new SHA-256.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        oldString: z.string().min(1),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }).strict(),
      outputSchema: fsEditOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async ({ authorityLeaseId, path, oldString, newString, replaceAll, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.edit(path, oldString, newString, {
      ...(replaceAll !== undefined ? { replaceAll } : {}),
      ...(expectedSha256 !== undefined ? { expectedSha256 } : {}),
    })),
  );

  server.registerTool(
    "fs_write",
    {
      description: "Create or atomically replace a file inside the active authority lease scope. Replacing an existing file requires expectedSha256 from a prior read/stat.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        content: z.string(),
        encoding: z.enum(["utf8", "base64"]).default("utf8"),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }),
      outputSchema: fsWriteOutputSchema,
      annotations: DESTRUCTIVE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, path, content, encoding, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.write(path, content, encoding, expectedSha256)),
  );

  server.registerTool(
    "fs_apply_patch",
    {
      description: "Apply a unified diff inside the active authority lease scope only if the file's current SHA-256 matches expectedSha256.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        patch: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      outputSchema: fsPatchOutputSchema,
      annotations: DESTRUCTIVE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, path, patch, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.patch(path, patch, expectedSha256)),
  );

  server.registerTool(
    "fs_mkdir",
    {
      description: "Create a directory and missing parents inside the active authority lease scope.",
      inputSchema: z.object({ ...authorityLeaseField, path: z.string() }),
      outputSchema: fsMkdirOutputSchema,
      annotations: WRITE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, path }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.makeDirectory(path)),
  );

  server.registerTool(
    "fs_move",
    {
      description: "Move a file or directory inside the active authority lease scope. Existing file sources require expectedSha256.",
      inputSchema: z.object({
        ...authorityLeaseField,
        source: z.string(),
        destination: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }),
      outputSchema: fsMoveOutputSchema,
      annotations: DESTRUCTIVE_IDEMPOTENT,
    },
    async ({ authorityLeaseId, source, destination, expectedSha256 }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.move(source, destination, expectedSha256)),
  );

  server.registerTool(
    "fs_remove",
    {
      description: "Remove a file or directory inside the active authority lease scope. Files require expectedSha256; directories require recursive=true. Allowed roots can never be removed.",
      inputSchema: z.object({
        ...authorityLeaseField,
        path: z.string(),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
        recursive: z.boolean().default(false),
      }),
      outputSchema: fsRemoveOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async ({ authorityLeaseId, path, expectedSha256, recursive }) => safeCall(() => withAuthority(runtime, authorityLeaseId).fs.remove(path, expectedSha256, recursive)),
  );
}
