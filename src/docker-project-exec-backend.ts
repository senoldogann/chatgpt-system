import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { LimitError, PolicyError, ProjectExecTimeoutError, SandboxUnavailableError } from "./errors.js";
import { resolveExecutablePath } from "./executable-resolution.js";
import type { ProjectExecBackend, ProjectExecRequest, ProjectExecResult } from "./project-exec-types.js";

export const PROJECT_EXEC_IMAGE = "chatgpt-system-project-exec:0.1.0";

const PROJECT_EXEC_CONTAINER_ROOT = "/workspace";
const PROJECT_EXEC_PIDS_LIMIT = 256;
const PROJECT_EXEC_MEMORY_LIMIT = "4g";
const PROJECT_EXEC_CPU_LIMIT = "4";
const PROJECT_EXEC_TMPFS_BYTES = 536_870_912;
const DOCKER_PREFLIGHT_TIMEOUT_MS = 5_000;
const DOCKER_PREFLIGHT_OUTPUT_BYTES = 65_536;

export interface DockerProjectExecInvocationInput {
  projectRoot: string;
  cwd: string;
  command: string;
  args: string[];
  containerName: string;
  uid?: number;
  gid?: number;
}

export interface DockerProjectExecInvocation {
  command: "docker";
  args: string[];
}

export interface DockerProjectExecBackendOptions {
  maxOutputBytes: number;
  cleanupTimeoutMs: number;
  dockerPath?: string;
}

interface DockerCommandResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

class DockerCommandInterruptedError extends Error {
  constructor(readonly reason: "timeout" | "output_limit") {
    super(reason);
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function containerWorkingDirectory(projectRoot: string, cwd: string): string {
  if (!isInside(projectRoot, cwd)) {
    throw new Error("Project execution cwd is outside project root.");
  }
  const relative = path.relative(projectRoot, cwd);
  return relative === ""
    ? PROJECT_EXEC_CONTAINER_ROOT
    : path.posix.join(PROJECT_EXEC_CONTAINER_ROOT, ...relative.split(path.sep));
}

export function buildDockerProjectExecInvocation(input: DockerProjectExecInvocationInput): DockerProjectExecInvocation {
  if (input.projectRoot.includes(",")) {
    throw new PolicyError("Project root cannot be represented safely in Docker mount syntax.");
  }

  const workdir = containerWorkingDirectory(input.projectRoot, input.cwd);
  const args = [
    "run",
    "--rm",
    "--pull=never",
    `--name=${input.containerName}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    `--pids-limit=${PROJECT_EXEC_PIDS_LIMIT}`,
    `--memory=${PROJECT_EXEC_MEMORY_LIMIT}`,
    `--cpus=${PROJECT_EXEC_CPU_LIMIT}`,
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,size=${PROJECT_EXEC_TMPFS_BYTES}`,
    "--mount",
    `type=bind,source=${input.projectRoot},target=${PROJECT_EXEC_CONTAINER_ROOT}`,
    `--workdir=${workdir}`,
    "--env",
    "HOME=/tmp",
    "--env",
    "CI=1",
    "--env",
    "NO_COLOR=1",
  ];

  if (input.uid !== undefined && input.gid !== undefined) {
    args.push(`--user=${input.uid}:${input.gid}`);
  }

  args.push(PROJECT_EXEC_IMAGE, input.command, ...input.args);
  return { command: "docker", args };
}

function dockerClientEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keys = [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
  ] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  env.CI = "1";
  env.NO_COLOR = "1";
  return env;
}

async function dockerExecutable(explicitPath?: string): Promise<string> {
  if (explicitPath !== undefined) return explicitPath;
  return (await resolveExecutablePath("docker", {
    pathValue: process.env.PATH,
    homeDir: process.env.HOME,
  })) ?? "docker";
}

async function runDockerCommand(
  args: string[],
  timeoutMs: number,
  maxOutputBytes: number,
  dockerPath?: string,
): Promise<DockerCommandResult> {
  const executable = await dockerExecutable(dockerPath);
  return new Promise<DockerCommandResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      env: dockerClientEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let reason: "timeout" | "output_limit" | undefined;

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (reason) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        reason = "output_limit";
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", () => {
      reject(new SandboxUnavailableError("docker_unavailable"));
    });

    const timer = setTimeout(() => {
      if (reason) return;
      reason = "timeout";
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (reason) {
        reject(new DockerCommandInterruptedError(reason));
        return;
      }
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function removeContainerBestEffort(
  containerName: string,
  timeoutMs: number,
  dockerPath?: string,
): Promise<void> {
  try {
    await runDockerCommand(["rm", "-f", containerName], timeoutMs, DOCKER_PREFLIGHT_OUTPUT_BYTES, dockerPath);
  } catch {
    // Birincil yürütme hatasından sonra container temizliği en iyi çaba ile yapılır.
  }
}

function newContainerName(): string {
  return `chatgpt-system-project-${randomBytes(12).toString("hex")}`;
}

export class DockerProjectExecBackend implements ProjectExecBackend {
  constructor(private readonly options: DockerProjectExecBackendOptions) {}

  async run(request: ProjectExecRequest): Promise<ProjectExecResult> {
    const preflightTimeoutMs = DOCKER_PREFLIGHT_TIMEOUT_MS;
    let context: DockerCommandResult;
    try {
      context = await runDockerCommand(
        ["context", "inspect", "--format", "{{(index .Endpoints \"docker\").Host}}"],
        preflightTimeoutMs,
        DOCKER_PREFLIGHT_OUTPUT_BYTES,
        this.options.dockerPath,
      );
    } catch {
      throw new SandboxUnavailableError("docker_unavailable");
    }
    const endpoint = context.stdout.trim();
    if (context.exitCode !== 0 || !endpoint.startsWith("unix://")) {
      throw new SandboxUnavailableError("nonlocal_docker_context");
    }

    let daemon: DockerCommandResult;
    try {
      daemon = await runDockerCommand(
        ["info", "--format", "{{.ServerVersion}}"],
        preflightTimeoutMs,
        DOCKER_PREFLIGHT_OUTPUT_BYTES,
        this.options.dockerPath,
      );
    } catch {
      throw new SandboxUnavailableError("docker_unavailable");
    }
    if (daemon.exitCode !== 0) throw new SandboxUnavailableError("docker_unavailable");

    let image: DockerCommandResult;
    try {
      image = await runDockerCommand(
        ["image", "inspect", PROJECT_EXEC_IMAGE, "--format", "{{.Id}}"],
        preflightTimeoutMs,
        DOCKER_PREFLIGHT_OUTPUT_BYTES,
        this.options.dockerPath,
      );
    } catch {
      throw new SandboxUnavailableError("image_unavailable");
    }
    if (image.exitCode !== 0) throw new SandboxUnavailableError("image_unavailable");

    const containerName = newContainerName();
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    const gid = typeof process.getgid === "function" ? process.getgid() : undefined;
    const invocation = buildDockerProjectExecInvocation({
      projectRoot: request.projectRoot,
      cwd: request.cwd,
      command: request.command,
      args: request.args,
      containerName,
      ...(uid !== undefined && gid !== undefined ? { uid, gid } : {}),
    });

    try {
      const result = await runDockerCommand(
        invocation.args,
        request.timeoutMs,
        this.options.maxOutputBytes,
        this.options.dockerPath,
      );
      if (result.exitCode === 125) throw new SandboxUnavailableError("backend_failure");
      return {
        command: request.command,
        args: [...request.args],
        cwd: request.cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: false,
        sandbox: {
          backend: "docker",
          network: "none",
          hostFallback: false,
        },
      };
    } catch (error) {
      await removeContainerBestEffort(containerName, this.options.cleanupTimeoutMs, this.options.dockerPath);
      if (error instanceof DockerCommandInterruptedError) {
        if (error.reason === "timeout") throw new ProjectExecTimeoutError(request.timeoutMs);
        throw new LimitError("Sandboxed project command output exceeded the configured byte limit.", {
          limit: this.options.maxOutputBytes,
        });
      }
      throw error;
    }
  }
}
