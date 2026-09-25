export type ProjectExecSandboxBackend = "docker";
export type ProjectExecNetworkMode = "none";

export interface ProjectExecRequest {
  projectRoot: string;
  cwd: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface ProjectExecResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  sandbox: {
    backend: ProjectExecSandboxBackend;
    network: ProjectExecNetworkMode;
    hostFallback: false;
  };
}

export interface ProjectExecBackend {
  run(request: ProjectExecRequest): Promise<ProjectExecResult>;
}
