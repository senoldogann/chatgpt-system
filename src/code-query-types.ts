export type CodeQueryOperation = "search" | "symbols";

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

export interface CodeQueryResponse<T extends CodeQuerySearchResult | CodeQuerySymbolResult> {
  operation: CodeQueryOperation;
  repositoryRoot: string;
  results: T[];
  truncated: boolean;
  scannedFiles: number;
  bytesScanned: number;
}
