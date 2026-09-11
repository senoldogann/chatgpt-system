import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ContinuityDatabaseInvalidError, ContinuityNotFoundError } from "./continuity-errors.js";
import { ConflictError } from "./errors.js";
import {
  continuityAliasKey,
  continuityAliasSchema,
  continuityLocalStateSchema,
  continuityProjectRootsSchema,
  continuityPublishedStateSchema,
  continuitySemanticInputSchema,
  continuitySemanticRecordSchema,
  storedWorktreeIdentitySchema,
  type CheckpointProjectRecord,
  type ContinuityLocalState,
  type ContinuityPublishedState,
  type ContinuitySemanticRecord,
  type RegisterProjectRecord,
  type StoredProject,
} from "./continuity-types.js";

export const CONTINUITY_SCHEMA_VERSION = 1;

interface ContinuityStoreOptions {
  databasePath: string;
  now?: () => number;
}

interface SemanticRecordRow {
  version: number;
  task_json: string;
  decisions_json: string;
  uncertainties_json: string;
  verification_summary_json: string;
  created_at: string;
}

interface ProjectRow {
  id: string;
  alias: string;
  alias_key: string;
  roots_json: string;
  current_record_version: number;
  created_at: string;
  updated_at: string;
  canonical_path: string;
  repository_root: string;
  common_git_dir: string;
  git_dir: string;
  repository_identity: string;
  worktree_identity: string;
  local_state_json: string;
  published_state_json: string;
  record_version: number;
  task_json: string;
  decisions_json: string;
  uncertainties_json: string;
  verification_summary_json: string;
  record_created_at: string;
}

function parseStoredValue<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new ContinuityDatabaseInvalidError("Stored project continuity data is invalid.");
    }
    throw error;
  }
}

function parseJson<T>(raw: string, schema: z.ZodType<T>): T {
  return parseStoredValue(() => schema.parse(JSON.parse(raw)));
}

const invalidDatabaseCodes = new Set(["SQLITE_CORRUPT", "SQLITE_FORMAT", "SQLITE_NOTADB"]);
const registrationConflictCodes = new Set(["SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_UNIQUE"]);

function initializeSchema(db: Database.Database): void {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;

  if (tables.length === 0) {
    db.exec(`
      CREATE TABLE continuity_meta (
        schema_version INTEGER NOT NULL
      );

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        alias_key TEXT NOT NULL UNIQUE,
        roots_json TEXT NOT NULL,
        current_record_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE worktrees (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        canonical_path TEXT NOT NULL UNIQUE,
        repository_root TEXT NOT NULL,
        common_git_dir TEXT NOT NULL,
        git_dir TEXT NOT NULL,
        repository_identity TEXT NOT NULL,
        worktree_identity TEXT NOT NULL,
        local_state_json TEXT NOT NULL,
        published_state_json TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );

      CREATE TABLE continuity_records (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        task_json TEXT NOT NULL,
        decisions_json TEXT NOT NULL,
        uncertainties_json TEXT NOT NULL,
        verification_summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, version)
      );
    `);
    db.prepare("INSERT INTO continuity_meta (schema_version) VALUES (?)").run(CONTINUITY_SCHEMA_VERSION);
    return;
  }

  const tableNames = new Set(tables.map((entry) => entry.name));
  const requiredTables = ["continuity_meta", "continuity_records", "projects", "worktrees"];
  if (requiredTables.some((table) => !tableNames.has(table))) {
    throw new ContinuityDatabaseInvalidError("The project continuity database schema is incomplete.");
  }

  const rows = db.prepare("SELECT schema_version FROM continuity_meta").all() as Array<{ schema_version: number }>;
  if (rows.length !== 1 || rows[0]?.schema_version !== CONTINUITY_SCHEMA_VERSION) {
    throw new ContinuityDatabaseInvalidError("The project continuity database schema version is unsupported.");
  }
}

function verifyDatabaseIntegrity(db: Database.Database): void {
  let result: unknown;
  try {
    result = db.pragma("quick_check", { simple: true });
  } catch (error) {
    if (error instanceof Database.SqliteError) {
      throw new ContinuityDatabaseInvalidError("The project continuity database failed its SQLite integrity check.");
    }
    throw error;
  }
  if (result !== "ok") {
    throw new ContinuityDatabaseInvalidError("The project continuity database failed its SQLite integrity check.");
  }
}

function openDatabase(databasePath: string): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  let db: Database.Database;
  try {
    db = new Database(databasePath);
  } catch (error) {
    if (error instanceof Database.SqliteError && invalidDatabaseCodes.has(error.code)) {
      throw new ContinuityDatabaseInvalidError();
    }
    throw error;
  }

  try {
    chmodSync(databasePath, 0o600);
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    initializeSchema(db);
    verifyDatabaseIntegrity(db);
    return db;
  } catch (error) {
    if (db.open) db.close();
    if (error instanceof ContinuityDatabaseInvalidError) throw error;
    if (error instanceof Database.SqliteError && invalidDatabaseCodes.has(error.code)) {
      throw new ContinuityDatabaseInvalidError();
    }
    throw error;
  }
}

export class ContinuityStore {
  private readonly db: Database.Database;
  private readonly now: () => number;
  private closed = false;

  constructor(options: ContinuityStoreOptions) {
    this.db = openDatabase(options.databasePath);
    this.now = options.now ?? Date.now;
  }

  register(input: RegisterProjectRecord): StoredProject {
    const alias = continuityAliasSchema.parse(input.alias);
    const roots = continuityProjectRootsSchema.parse(input.roots);
    const worktree = storedWorktreeIdentitySchema.parse(input.worktree);
    const localState = continuityLocalStateSchema.parse(input.localState);
    const publishedState = continuityPublishedStateSchema.parse(input.publishedState);
    const semantic = continuitySemanticInputSchema.parse(input.semantic);
    const timestamp = new Date(this.now()).toISOString();
    const recordVersion = 1;
    const aliasKey = continuityAliasKey(alias);

    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO projects (
          id, alias, alias_key, roots_json, current_record_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        alias,
        aliasKey,
        JSON.stringify(roots),
        recordVersion,
        timestamp,
        timestamp,
      );

      this.db.prepare(`
        INSERT INTO worktrees (
          project_id, canonical_path, repository_root, common_git_dir, git_dir,
          repository_identity, worktree_identity, local_state_json, published_state_json, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        worktree.canonicalPath,
        worktree.repositoryRoot,
        worktree.commonGitDir,
        worktree.gitDir,
        worktree.repositoryIdentity,
        worktree.worktreeIdentity,
        JSON.stringify(localState),
        JSON.stringify(publishedState),
        localState.checkedAt,
      );

      this.db.prepare(`
        INSERT INTO continuity_records (
          project_id, version, task_json, decisions_json, uncertainties_json,
          verification_summary_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        recordVersion,
        JSON.stringify(semantic.task),
        JSON.stringify(semantic.decisions),
        JSON.stringify(semantic.uncertainties),
        JSON.stringify(semantic.verificationSummary),
        timestamp,
      );
    });

    try {
      transaction();
    } catch (error) {
      if (error instanceof Database.SqliteError && registrationConflictCodes.has(error.code)) {
        throw new ConflictError("A project with the same continuity alias, ID, or worktree is already registered.");
      }
      throw error;
    }
    return this.getByAlias(aliasKey);
  }

  getByAlias(alias: string): StoredProject {
    const row = this.db.prepare(`
      SELECT
        p.id,
        p.alias,
        p.alias_key,
        p.roots_json,
        p.current_record_version,
        p.created_at,
        p.updated_at,
        w.canonical_path,
        w.repository_root,
        w.common_git_dir,
        w.git_dir,
        w.repository_identity,
        w.worktree_identity,
        w.local_state_json,
        w.published_state_json,
        r.version AS record_version,
        r.task_json,
        r.decisions_json,
        r.uncertainties_json,
        r.verification_summary_json,
        r.created_at AS record_created_at
      FROM projects p
      JOIN worktrees w ON w.project_id = p.id
      JOIN continuity_records r
        ON r.project_id = p.id
       AND r.version = p.current_record_version
      WHERE p.alias_key = ?
    `).get(continuityAliasKey(alias)) as ProjectRow | undefined;

    if (!row) throw new ContinuityNotFoundError();

    return parseStoredValue(() => ({
      id: row.id,
      alias: row.alias,
      aliasKey: row.alias_key,
      roots: parseJson(row.roots_json, continuityProjectRootsSchema),
      worktree: storedWorktreeIdentitySchema.parse({
        canonicalPath: row.canonical_path,
        repositoryRoot: row.repository_root,
        commonGitDir: row.common_git_dir,
        gitDir: row.git_dir,
        repositoryIdentity: row.repository_identity,
        worktreeIdentity: row.worktree_identity,
      }),
      localState: parseJson(row.local_state_json, continuityLocalStateSchema),
      publishedState: parseJson(row.published_state_json, continuityPublishedStateSchema),
      currentRecord: continuitySemanticRecordSchema.parse({
        recordVersion: row.record_version,
        task: JSON.parse(row.task_json),
        decisions: JSON.parse(row.decisions_json),
        uncertainties: JSON.parse(row.uncertainties_json),
        verificationSummary: JSON.parse(row.verification_summary_json),
        createdAt: row.record_created_at,
      }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getRecord(projectId: string, version: number): ContinuitySemanticRecord {
    const row = this.db.prepare(`
      SELECT version, task_json, decisions_json, uncertainties_json, verification_summary_json, created_at
      FROM continuity_records
      WHERE project_id = ? AND version = ?
    `).get(projectId, version) as SemanticRecordRow | undefined;

    if (!row) throw new ContinuityNotFoundError("The requested continuity record was not found.");
    return this.parseSemanticRecord(row);
  }

  checkpoint(input: CheckpointProjectRecord): ContinuitySemanticRecord {
    const semantic = continuitySemanticInputSchema.parse(input.semantic);
    const localState = continuityLocalStateSchema.parse(input.localState);
    const publishedState = continuityPublishedStateSchema.parse(input.publishedState);
    const timestamp = new Date(this.now()).toISOString();
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare(
        "SELECT current_record_version FROM projects WHERE id = ?",
      ).get(input.projectId) as { current_record_version: number } | undefined;

      if (!current) throw new ContinuityNotFoundError();
      if (current.current_record_version !== input.expectedRecordVersion) {
        throw new ConflictError("Continuity record version changed; reread the current project before checkpointing.", {
          expectedRecordVersion: input.expectedRecordVersion,
          currentRecordVersion: current.current_record_version,
        });
      }

      const nextVersion = current.current_record_version + 1;
      this.db.prepare(`
        INSERT INTO continuity_records (
          project_id, version, task_json, decisions_json, uncertainties_json,
          verification_summary_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.projectId,
        nextVersion,
        JSON.stringify(semantic.task),
        JSON.stringify(semantic.decisions),
        JSON.stringify(semantic.uncertainties),
        JSON.stringify(semantic.verificationSummary),
        timestamp,
      );

      this.db.prepare(`
        UPDATE worktrees
        SET local_state_json = ?, published_state_json = ?, checked_at = ?
        WHERE project_id = ?
      `).run(
        JSON.stringify(localState),
        JSON.stringify(publishedState),
        localState.checkedAt,
        input.projectId,
      );

      this.db.prepare(`
        UPDATE projects
        SET current_record_version = ?, updated_at = ?
        WHERE id = ?
      `).run(nextVersion, timestamp, input.projectId);

      return nextVersion;
    });

    return this.getRecord(input.projectId, transaction());
  }

  updateOperationalState(
    projectId: string,
    localState: ContinuityLocalState,
    publishedState: ContinuityPublishedState,
    checkedAt: string,
  ): void {
    const parsedLocalState = continuityLocalStateSchema.parse(localState);
    const parsedPublishedState = continuityPublishedStateSchema.parse(publishedState);
    const result = this.db.prepare(`
      UPDATE worktrees
      SET local_state_json = ?, published_state_json = ?, checked_at = ?
      WHERE project_id = ?
    `).run(
      JSON.stringify(parsedLocalState),
      JSON.stringify(parsedPublishedState),
      parsedLocalState.checkedAt,
      projectId,
    );
    if (result.changes !== 1) throw new ContinuityNotFoundError();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private parseSemanticRecord(row: SemanticRecordRow): ContinuitySemanticRecord {
    return parseStoredValue(() => continuitySemanticRecordSchema.parse({
      recordVersion: row.version,
      task: JSON.parse(row.task_json),
      decisions: JSON.parse(row.decisions_json),
      uncertainties: JSON.parse(row.uncertainties_json),
      verificationSummary: JSON.parse(row.verification_summary_json),
      createdAt: row.created_at,
    }));
  }
}
