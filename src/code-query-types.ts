export type CodeQueryOperation = "search" | "symbols" | "definition" | "references" | "diagnostics";

export interface CodeQuerySearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
  sha256: string;
}

export type CodeSymbolKind = "variable" | "function" | "class" | "interface" | "type" | "enum";

export interface CodeQuerySymbolResult {
  path: string;
  name: string;
  kind: CodeSymbolKind;
  line: number;
  column: number;
  sha256: string;
}

export interface CodeQueryLocationResult {
  path: string;
  line: number;
  column: number;
  sha256: string;
}

export interface CodeQueryReferenceResult extends CodeQueryLocationResult {
  isDefinition: boolean;
}

export type CodeDiagnosticSeverity = "error" | "warning" | "suggestion" | "message";

export interface CodeQueryDiagnosticResult extends CodeQueryLocationResult {
  severity: CodeDiagnosticSeverity;
  code: number;
  message: string;
}

export type CodeQueryResult =
  | CodeQuerySearchResult
  | CodeQuerySymbolResult
  | CodeQueryLocationResult
  | CodeQueryReferenceResult
  | CodeQueryDiagnosticResult;

export interface CodeQueryResponse<T extends CodeQueryResult> {
  operation: CodeQueryOperation;
  repositoryRoot: string;
  results: T[];
  truncated: boolean;
  scannedFiles: number;
  bytesScanned: number;
}
