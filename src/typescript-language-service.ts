import path from "node:path";
import type tsType from "typescript";
import { LspUnavailableError, PolicyError } from "./errors.js";
import type {
  CodeDiagnosticSeverity,
  CodeQueryDiagnosticResult,
  CodeQueryLocationResult,
  CodeQueryReferenceResult,
} from "./code-query-types.js";

export interface TypeScriptLanguageSource {
  absolutePath: string;
  relativePath: string;
  text: string;
  sha256: string;
}

export interface SemanticQueryResult<T> {
  results: T[];
  truncated: boolean;
}

export interface CodeLanguageServiceAdapter {
  definition(filePath: string, line: number, column: number, maxResults: number): SemanticQueryResult<CodeQueryLocationResult>;
  references(filePath: string, line: number, column: number, maxResults: number): SemanticQueryResult<CodeQueryReferenceResult>;
  diagnostics(filePath: string, maxResults: number): SemanticQueryResult<CodeQueryDiagnosticResult>;
  close(): void;
}

const TYPESCRIPT_EXTENSIONS = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalize(filePath: string): string {
  return path.resolve(filePath);
}

function lineColumnToOffset(text: string, line: number, column: number): number {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 1) {
    throw new PolicyError("Semantic code positions use positive 1-based line and column values.");
  }
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  const start = starts[line - 1];
  if (start === undefined) throw new PolicyError("Semantic code position line is outside the file.");
  const next = starts[line] ?? text.length + 1;
  let lineEnd = next - 1;
  if (lineEnd > start && text.charCodeAt(lineEnd - 1) === 13) lineEnd -= 1;
  const offset = start + column - 1;
  if (offset > lineEnd) throw new PolicyError("Semantic code position column is outside the file.");
  return offset;
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < bounded; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: bounded - lineStart + 1 };
}

function severity(ts: typeof tsType, category: tsType.DiagnosticCategory): CodeDiagnosticSeverity {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  if (category === ts.DiagnosticCategory.Suggestion) return "suggestion";
  return "message";
}

async function loadTypeScript(): Promise<typeof tsType> {
  try {
    const module = await import("typescript");
    return (module.default ?? module) as unknown as typeof tsType;
  } catch {
    throw new LspUnavailableError("typescript_module_unavailable");
  }
}

export class TypeScriptLanguageServiceAdapter implements CodeLanguageServiceAdapter {
  private constructor(
    private readonly ts: typeof tsType,
    private readonly root: string,
    private readonly sources: Map<string, TypeScriptLanguageSource>,
    private readonly service: tsType.LanguageService,
  ) {}

  static async create(
    root: string,
    sourcesInput: TypeScriptLanguageSource[],
    tsconfigText?: string,
  ): Promise<TypeScriptLanguageServiceAdapter> {
    const ts = await loadTypeScript();
    const rootPath = normalize(root);
    const sources = new Map<string, TypeScriptLanguageSource>();
    for (const source of sourcesInput) {
      const absolutePath = normalize(source.absolutePath);
      if (!inside(rootPath, absolutePath)) continue;
      if (!TYPESCRIPT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) continue;
      sources.set(absolutePath, { ...source, absolutePath });
    }
    if (sources.size === 0) throw new LspUnavailableError("typescript_sources_unavailable");

    let compilerOptions: tsType.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      noEmit: true,
      strict: true,
      noLib: true,
      types: [],
    };
    if (tsconfigText !== undefined) {
      const configPath = path.join(rootPath, "tsconfig.json");
      const parsed = ts.parseConfigFileTextToJson(configPath, tsconfigText);
      if (parsed.error || parsed.config === undefined) throw new LspUnavailableError("typescript_config_invalid");
      if (parsed.config.extends !== undefined) throw new LspUnavailableError("typescript_config_extends_unsupported");
      const converted = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions ?? {}, rootPath, configPath);
      if (converted.errors.length > 0) throw new LspUnavailableError("typescript_config_invalid");
      compilerOptions = { ...converted.options, noEmit: true, noLib: true, types: [] };
    }

    const sourceDirectories = new Set<string>();
    for (const fileName of sources.keys()) {
      let current = path.dirname(fileName);
      while (inside(rootPath, current)) {
        sourceDirectories.add(current);
        if (current === rootPath) break;
        current = path.dirname(current);
      }
    }

    const readableSource = (fileName: string): TypeScriptLanguageSource | undefined => sources.get(normalize(fileName));
    const host: tsType.LanguageServiceHost = {
      getCompilationSettings: () => compilerOptions,
      getScriptFileNames: () => [...sources.keys()],
      getScriptVersion: (fileName) => readableSource(fileName)?.sha256 ?? "0",
      getScriptSnapshot: (fileName) => {
        const source = readableSource(fileName);
        return source ? ts.ScriptSnapshot.fromString(source.text) : undefined;
      },
      getCurrentDirectory: () => rootPath,
      getDefaultLibFileName: () => path.join(rootPath, "__chatgpt_system_no_lib__.d.ts"),
      fileExists: (fileName) => readableSource(fileName) !== undefined,
      readFile: (fileName) => readableSource(fileName)?.text,
      directoryExists: (directoryName) => sourceDirectories.has(normalize(directoryName)),
      getDirectories: (directoryName) => {
        const directory = normalize(directoryName);
        const children = new Set<string>();
        for (const candidate of sourceDirectories) {
          if (path.dirname(candidate) === directory) children.add(candidate);
        }
        return [...children];
      },
      realpath: (fileName) => normalize(fileName),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
      getNewLine: () => "\n",
    };

    return new TypeScriptLanguageServiceAdapter(ts, rootPath, sources, ts.createLanguageService(host));
  }

  private source(filePath: string): TypeScriptLanguageSource {
    const normalized = normalize(filePath);
    if (!inside(this.root, normalized)) throw new PolicyError("Semantic code path is outside the repository.");
    const source = this.sources.get(normalized);
    if (!source) throw new LspUnavailableError("typescript_file_unavailable");
    return source;
  }

  private location(fileName: string, start: number): CodeQueryLocationResult | undefined {
    const source = this.sources.get(normalize(fileName));
    if (!source) return undefined;
    const position = offsetToLineColumn(source.text, start);
    return {
      path: source.relativePath,
      line: position.line,
      column: position.column,
      sha256: source.sha256,
    };
  }

  definition(filePath: string, line: number, column: number, maxResults: number): SemanticQueryResult<CodeQueryLocationResult> {
    const source = this.source(filePath);
    const offset = lineColumnToOffset(source.text, line, column);
    const definitions = this.service.getDefinitionAtPosition(source.absolutePath, offset) ?? [];
    const results: CodeQueryLocationResult[] = [];
    const seen = new Set<string>();
    let truncated = false;
    for (const definition of definitions) {
      const failedAliasResolution = (definition as typeof definition & { failedAliasResolution?: boolean })
        .failedAliasResolution === true;
      if (failedAliasResolution) continue;
      const location = this.location(definition.fileName, definition.textSpan.start);
      if (!location) continue;
      const key = `${location.path}:${location.line}:${location.column}`;
      if (seen.has(key)) continue;
      if (results.length >= maxResults) {
        truncated = true;
        break;
      }
      seen.add(key);
      results.push(location);
    }
    return { results, truncated };
  }

  references(filePath: string, line: number, column: number, maxResults: number): SemanticQueryResult<CodeQueryReferenceResult> {
    const source = this.source(filePath);
    const offset = lineColumnToOffset(source.text, line, column);
    const referenced = this.service.findReferences(source.absolutePath, offset) ?? [];
    const results: CodeQueryReferenceResult[] = [];
    const seen = new Set<string>();
    let truncated = false;

    const append = (fileName: string, start: number, isDefinition: boolean) => {
      const location = this.location(fileName, start);
      if (!location) return true;
      const key = `${location.path}:${location.line}:${location.column}`;
      if (seen.has(key)) return true;
      if (results.length >= maxResults) {
        truncated = true;
        return false;
      }
      seen.add(key);
      results.push({ ...location, isDefinition });
      return true;
    };

    outer: for (const symbol of referenced) {
      if (!append(symbol.definition.fileName, symbol.definition.textSpan.start, true)) break;
      for (const reference of symbol.references) {
        if (!append(reference.fileName, reference.textSpan.start, reference.isDefinition === true)) break outer;
      }
    }
    return { results, truncated };
  }

  diagnostics(filePath: string, maxResults: number): SemanticQueryResult<CodeQueryDiagnosticResult> {
    const source = this.source(filePath);
    const diagnostics = [
      ...this.service.getSyntacticDiagnostics(source.absolutePath),
      ...this.service.getSemanticDiagnostics(source.absolutePath),
      ...this.service.getSuggestionDiagnostics(source.absolutePath),
    ];
    const results: CodeQueryDiagnosticResult[] = [];
    let truncated = false;
    for (const diagnostic of diagnostics) {
      if (results.length >= maxResults) {
        truncated = true;
        break;
      }
      const start = diagnostic.start ?? 0;
      const location = this.location(source.absolutePath, start);
      if (!location) continue;
      results.push({
        ...location,
        severity: severity(this.ts, diagnostic.category),
        code: diagnostic.code,
        message: this.ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      });
    }
    return { results, truncated };
  }

  close(): void {
    this.service.dispose();
  }
}
