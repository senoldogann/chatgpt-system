import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import type { AuditLogger } from "./audit.js";
import type { LimitsConfig } from "./config.js";
import { LimitError, LspUnavailableError, PolicyError } from "./errors.js";
import type {
  CodeQueryDiagnosticResult,
  CodeQueryLocationResult,
  CodeQueryReferenceResult,
  CodeQueryResponse,
  CodeQuerySearchResult,
  CodeQuerySymbolResult,
  CodeSymbolKind,
} from "./code-query-types.js";
import { PathPolicy } from "./policy.js";
import { TypeScriptLanguageServiceAdapter, type TypeScriptLanguageSource } from "./typescript-language-service.js";

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 200;
const MAX_QUERY_CHARS = 4_096;
const MAX_SCAN_FILES = 5_000;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const GIT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".turbo",
  ".vite",
  ".gradle",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
  "DerivedData",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z", ".a", ".avi", ".bin", ".bmp", ".class", ".dmg", ".doc", ".docx",
  ".eot", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".lockb",
  ".mov", ".mp3", ".mp4", ".o", ".pdf", ".png", ".ppt", ".pptx", ".pyc",
  ".so", ".tar", ".tgz", ".ttf", ".wav", ".webp", ".woff", ".woff2", ".xls",
  ".xlsx", ".zip",
]);

const SYMBOL_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

const SECRET_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_ed25519",
  "id_rsa",
  "secrets.json",
]);

const SYMBOL_PATTERNS: Array<{ kind: CodeSymbolKind; pattern: RegExp }> = [
  { kind: "function", pattern: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
  { kind: "class", pattern: /\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: "interface", pattern: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: "type", pattern: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/ },
  { kind: "enum", pattern: /\b(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: "variable", pattern: /\b(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
];

interface GitCommandResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
}

interface CandidateFile {
  absolutePath: string;
  relativePath: string;
}

interface ReadTextResult {
  bytes: Buffer;
  text: string;
  sha256: string;
}

function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "TMPDIR"] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.GIT_OPTIONAL_LOCKS = "0";
  return env;
}

async function runGit(cwd: string, args: string[], timeoutMs: number): Promise<GitCommandResult> {
  return new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn(
      "git",
      [
        "-c", "core.hooksPath=/dev/null",
        "-c", "core.fsmonitor=false",
        "-c", "diff.external=",
        "-c", "interactive.diffFilter=",
        ...args,
      ],
      {
        cwd,
        shell: false,
        env: gitEnvironment(process.env),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let tooLarge = false;
    let timedOut = false;

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (tooLarge) return;
      bytes += chunk.byteLength;
      if (bytes > GIT_OUTPUT_LIMIT_BYTES) {
        tooLarge = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PolicyError("Code query Git discovery exceeded the configured timeout."));
        return;
      }
      if (tooLarge) {
        reject(new LimitError("Code query Git discovery exceeded its output limit."));
        return;
      }
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

function validateMaxResults(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > MAX_RESULTS) {
    throw new PolicyError(`Code query maxResults must be between 1 and ${MAX_RESULTS}.`);
  }
  return resolved;
}

function validateQuery(query: string, optional = false): string {
  if (optional && query.length === 0) return "";
  if (!query || query.length > MAX_QUERY_CHARS || query.includes("\u0000")) {
    throw new PolicyError(`Code query text must contain 1-${MAX_QUERY_CHARS} non-NUL characters.`);
  }
  return query;
}

function pathSegments(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

function looksSecret(relativePath: string): boolean {
  const basename = path.basename(relativePath).toLowerCase();
  if (basename === ".env" || (basename.startsWith(".env.") && !/\.(example|sample|template)$/.test(basename))) {
    return true;
  }
  if (SECRET_BASENAMES.has(basename)) return true;
  if (/\.(?:pem|key|p12|pfx)$/i.test(basename)) return true;
  return /^(?:secrets?|credentials?)(?:\.(?:json|ya?ml|toml|ini))?$/i.test(basename);
}

function shouldExcludePath(relativePath: string): boolean {
  const segments = pathSegments(relativePath);
  if (segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) return true;
  if (looksSecret(relativePath)) return true;
  return BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function posixRelative(value: string): string {
  return value.split(path.sep).join("/");
}

async function readBoundedText(filePath: string, maxBytes: number): Promise<ReadTextResult | null> {
  let handle;
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) return null;
    handle = await open(filePath, "r");
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return null;
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) return null;
    const text = bytes.toString("utf8");
    if (text.includes("\uFFFD")) return null;
    return {
      bytes,
      text,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

function matchingSymbols(text: string, filter: string): Array<Omit<CodeQuerySymbolResult, "path" | "sha256">> {
  const normalizedFilter = filter.toLowerCase();
  const results: Array<Omit<CodeQuerySymbolResult, "path" | "sha256">> = [];
  for (const [lineIndex, lineText] of text.split(/\r?\n/).entries()) {
    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      const match = pattern.exec(lineText);
      const name = match?.[1];
      if (!name || (normalizedFilter && !name.toLowerCase().includes(normalizedFilter))) continue;
      const column = lineText.indexOf(name) + 1;
      results.push({ name, kind, line: lineIndex + 1, column });
      break;
    }
  }
  return results;
}

export class CodeQueryService {
  constructor(
    private readonly policy: PathPolicy,
    private readonly audit: AuditLogger,
    private readonly limits: Pick<LimitsConfig, "maxReadBytes" | "commandTimeoutMs">,
  ) {}

  private async repository(cwdInput: string): Promise<{ cwd: string; root: string; files: CandidateFile[] }> {
    const cwd = await this.policy.resolve(cwdInput);
    const rootResult = await runGit(cwd, ["rev-parse", "--show-toplevel"], this.limits.commandTimeoutMs);
    if (rootResult.exitCode !== 0) throw new PolicyError("Code query requires a Git repository.");
    const discoveredRoot = rootResult.stdout.toString("utf8").trim();
    if (!discoveredRoot) throw new PolicyError("Code query could not determine the repository root.");
    const root = await this.policy.resolve(discoveredRoot);

    const listResult = await runGit(
      root,
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      this.limits.commandTimeoutMs,
    );
    if (listResult.exitCode !== 0) throw new PolicyError("Code query could not enumerate repository files.");

    const files: CandidateFile[] = [];
    const names = listResult.stdout.toString("utf8").split("\u0000").filter(Boolean);
    for (const name of names) {
      if (files.length >= MAX_SCAN_FILES) break;
      const relativePath = posixRelative(name);
      if (shouldExcludePath(relativePath)) continue;
      const absolutePath = path.resolve(root, name);
      const relative = path.relative(root, absolutePath);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue;
      files.push({ absolutePath, relativePath });
    }
    return { cwd, root, files };
  }

  private async semanticContext(cwdInput: string, pathInput: string) {
    const repository = await this.repository(cwdInput);
    const requestedPath = path.isAbsolute(pathInput) ? pathInput : path.join(repository.root, pathInput);
    const targetPath = await this.policy.resolve(requestedPath);
    const relative = path.relative(repository.root, targetPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new PolicyError("Semantic code path must stay inside the selected repository.");
    }
    if (!SYMBOL_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
      throw new LspUnavailableError("unsupported_language");
    }

    const sources: TypeScriptLanguageSource[] = [];
    let scannedFiles = 0;
    let bytesScanned = 0;
    let tsconfigText: string | undefined;
    for (const file of repository.files) {
      const extension = path.extname(file.relativePath).toLowerCase();
      const isTsConfig = file.relativePath === "tsconfig.json";
      if (!SYMBOL_EXTENSIONS.has(extension) && !isTsConfig) continue;
      const read = await readBoundedText(file.absolutePath, this.limits.maxReadBytes);
      if (!read) continue;
      if (bytesScanned + read.bytes.byteLength > MAX_SCAN_BYTES) {
        throw new LimitError("Semantic code intelligence exceeded its repository scan limit.");
      }
      scannedFiles += 1;
      bytesScanned += read.bytes.byteLength;
      if (isTsConfig) {
        tsconfigText = read.text;
        continue;
      }
      sources.push({
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        text: read.text,
        sha256: read.sha256,
      });
    }

    const target = sources.find((source) => source.absolutePath === targetPath);
    if (!target) throw new LspUnavailableError("typescript_file_unavailable");
    const adapter = await TypeScriptLanguageServiceAdapter.create(repository.root, sources, tsconfigText);
    return {
      repository,
      target,
      adapter,
      scannedFiles,
      bytesScanned,
      scanTruncated: repository.files.length >= MAX_SCAN_FILES,
    };
  }

  private async semanticQuery<T extends CodeQueryLocationResult | CodeQueryReferenceResult | CodeQueryDiagnosticResult>(
    operation: "definition" | "references" | "diagnostics",
    cwdInput: string,
    pathInput: string,
    maxResultsInput: number | undefined,
    run: (
      adapter: TypeScriptLanguageServiceAdapter,
      targetPath: string,
      maxResults: number,
    ) => { results: T[]; truncated: boolean },
  ): Promise<CodeQueryResponse<T>> {
    const maxResults = validateMaxResults(maxResultsInput);
    const context = await this.semanticContext(cwdInput, pathInput);
    try {
      return await this.audit.run(
        "code.query",
        this.policy.display(context.repository.root),
        async () => {
          const result = run(context.adapter, context.target.absolutePath, maxResults);
          return {
            operation,
            repositoryRoot: this.policy.display(context.repository.root),
            results: result.results,
            truncated: result.truncated || context.scanTruncated,
            scannedFiles: context.scannedFiles,
            bytesScanned: context.bytesScanned,
          };
        },
        { operation, maxResults },
      );
    } finally {
      context.adapter.close();
    }
  }

  async definition(
    pathInput: string,
    line: number,
    column: number,
    cwdInput = ".",
    maxResultsInput?: number,
  ): Promise<CodeQueryResponse<CodeQueryLocationResult>> {
    return this.semanticQuery(
      "definition",
      cwdInput,
      pathInput,
      maxResultsInput,
      (adapter, targetPath, maxResults) => adapter.definition(targetPath, line, column, maxResults),
    );
  }

  async references(
    pathInput: string,
    line: number,
    column: number,
    cwdInput = ".",
    maxResultsInput?: number,
  ): Promise<CodeQueryResponse<CodeQueryReferenceResult>> {
    return this.semanticQuery(
      "references",
      cwdInput,
      pathInput,
      maxResultsInput,
      (adapter, targetPath, maxResults) => adapter.references(targetPath, line, column, maxResults),
    );
  }

  async diagnostics(
    pathInput: string,
    cwdInput = ".",
    maxResultsInput?: number,
  ): Promise<CodeQueryResponse<CodeQueryDiagnosticResult>> {
    return this.semanticQuery(
      "diagnostics",
      cwdInput,
      pathInput,
      maxResultsInput,
      (adapter, targetPath, maxResults) => adapter.diagnostics(targetPath, maxResults),
    );
  }

  async search(
    queryInput: string,
    cwdInput = ".",
    maxResultsInput?: number,
  ): Promise<CodeQueryResponse<CodeQuerySearchResult>> {
    const query = validateQuery(queryInput);
    const maxResults = validateMaxResults(maxResultsInput);
    const repository = await this.repository(cwdInput);

    return this.audit.run(
      "code.query",
      this.policy.display(repository.root),
      async () => {
        const results: CodeQuerySearchResult[] = [];
        let scannedFiles = 0;
        let bytesScanned = 0;
        let truncated = repository.files.length >= MAX_SCAN_FILES;
        const normalizedQuery = query.toLowerCase();

        fileLoop: for (const file of repository.files) {
          const read = await readBoundedText(file.absolutePath, this.limits.maxReadBytes);
          if (!read) continue;
          if (bytesScanned + read.bytes.byteLength > MAX_SCAN_BYTES) {
            truncated = true;
            break;
          }
          scannedFiles += 1;
          bytesScanned += read.bytes.byteLength;
          const lines = read.text.split(/\r?\n/);
          for (const [lineIndex, lineText] of lines.entries()) {
            const columnIndex = lineText.toLowerCase().indexOf(normalizedQuery);
            if (columnIndex < 0) continue;
            if (results.length >= maxResults) {
              truncated = true;
              break fileLoop;
            }
            results.push({
              path: file.relativePath,
              line: lineIndex + 1,
              column: columnIndex + 1,
              preview: lineText.length <= 1_024 ? lineText : `${lineText.slice(0, 1_021)}...`,
              sha256: read.sha256,
            });
          }
        }

        return {
          operation: "search",
          repositoryRoot: this.policy.display(repository.root),
          results,
          truncated,
          scannedFiles,
          bytesScanned,
        };
      },
      { operation: "search", maxResults },
    );
  }

  async symbols(
    queryInput = "",
    cwdInput = ".",
    maxResultsInput?: number,
  ): Promise<CodeQueryResponse<CodeQuerySymbolResult>> {
    const query = validateQuery(queryInput, true);
    const maxResults = validateMaxResults(maxResultsInput);
    const repository = await this.repository(cwdInput);

    return this.audit.run(
      "code.query",
      this.policy.display(repository.root),
      async () => {
        const results: CodeQuerySymbolResult[] = [];
        let scannedFiles = 0;
        let bytesScanned = 0;
        let truncated = repository.files.length >= MAX_SCAN_FILES;

        fileLoop: for (const file of repository.files) {
          if (!SYMBOL_EXTENSIONS.has(path.extname(file.relativePath).toLowerCase())) continue;
          const read = await readBoundedText(file.absolutePath, this.limits.maxReadBytes);
          if (!read) continue;
          if (bytesScanned + read.bytes.byteLength > MAX_SCAN_BYTES) {
            truncated = true;
            break;
          }
          scannedFiles += 1;
          bytesScanned += read.bytes.byteLength;
          for (const symbol of matchingSymbols(read.text, query)) {
            if (results.length >= maxResults) {
              truncated = true;
              break fileLoop;
            }
            results.push({
              path: file.relativePath,
              ...symbol,
              sha256: read.sha256,
            });
          }
        }

        return {
          operation: "symbols",
          repositoryRoot: this.policy.display(repository.root),
          results,
          truncated,
          scannedFiles,
          bytesScanned,
        };
      },
      { operation: "symbols", maxResults, filtered: query.length > 0 },
    );
  }
}
