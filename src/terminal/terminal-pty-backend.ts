type NodePtyModule = Pick<typeof import("node-pty"), "spawn">;

export interface TerminalPtyExit {
  exitCode: number;
  signal?: number;
}

export interface TerminalPtyDisposable {
  dispose(): void;
}

export interface TerminalPtyHandle {
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): TerminalPtyDisposable;
  onExit(listener: (event: TerminalPtyExit) => void): TerminalPtyDisposable;
}

export interface TerminalPtySpawnInput {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface TerminalPtyBackend {
  spawn(input: TerminalPtySpawnInput): Promise<TerminalPtyHandle>;
}

export type NodePtyImporter = () => Promise<NodePtyModule>;

export class NodePtyBackend implements TerminalPtyBackend {
  private modulePromise: Promise<NodePtyModule> | undefined;

  constructor(
    private readonly importer: NodePtyImporter = async () => import("node-pty"),
  ) {}

  async spawn(input: TerminalPtySpawnInput): Promise<TerminalPtyHandle> {
    const module = await this.loadModule();
    const pty = module.spawn(input.file, input.args, {
      name: "xterm-256color",
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: input.env,
      encoding: "utf8",
    });

    return {
      get pid() {
        return pty.pid;
      },
      get cols() {
        return pty.cols;
      },
      get rows() {
        return pty.rows;
      },
      write(data: string): void {
        pty.write(data);
      },
      resize(cols: number, rows: number): void {
        pty.resize(cols, rows);
      },
      kill(signal?: string): void {
        if (signal === undefined) {
          pty.kill();
          return;
        }
        pty.kill(signal);
      },
      onData(listener: (data: string) => void): TerminalPtyDisposable {
        return pty.onData(listener);
      },
      onExit(listener: (event: TerminalPtyExit) => void): TerminalPtyDisposable {
        return pty.onExit(listener);
      },
    };
  }

  private loadModule(): Promise<NodePtyModule> {
    this.modulePromise ??= this.importer();
    return this.modulePromise;
  }
}
