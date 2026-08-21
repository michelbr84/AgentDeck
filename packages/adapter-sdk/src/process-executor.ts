import { spawn, SpawnOptions } from 'node:child_process';
import { isSafeCliArgument } from '@agentdeck/security';

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface StreamCallbacks {
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

/**
 * Executes a subprocess safely without a shell (shell: false) and with strict argument validation.
 */
export async function executeSafeCommand(
  spec: CommandSpec,
  stream?: StreamCallbacks
): Promise<CommandOutput> {
  // Validate CLI arguments
  for (const arg of spec.args) {
    if (!isSafeCliArgument(arg)) {
      throw new Error(`Unsafe CLI argument rejected by security policy: ${arg}`);
    }
  }

  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: spec.cwd,
      env: spec.env ? { ...process.env, ...spec.env } : process.env,
      shell: false,
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, spec.args, spawnOpts);
    } catch (err) {
      return reject(new Error(`Failed to spawn process "${spec.command}": ${(err as Error).message}`));
    }

    let stdout = '';
    let stderr = '';
    let isTerminated = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    if (spec.timeoutMs && spec.timeoutMs > 0) {
      timer = setTimeout(() => {
        isTerminated = true;
        terminateProcess(child.pid, 2000);
      }, spec.timeoutMs);
    }

    if (spec.abortSignal) {
      if (spec.abortSignal.aborted) {
        terminateProcess(child.pid, 1000);
        cleanup();
        return reject(new Error('Process execution aborted before start'));
      }
      spec.abortSignal.addEventListener('abort', () => {
        isTerminated = true;
        terminateProcess(child.pid, 2000);
      });
    }

    child.stdout?.on('data', (data: Buffer) => {
      const str = data.toString('utf8');
      stdout += str;
      if (stream?.onStdoutChunk) {
        stream.onStdoutChunk(str);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const str = data.toString('utf8');
      stderr += str;
      if (stream?.onStderrChunk) {
        stream.onStderrChunk(str);
      }
    });

    child.on('error', (err) => {
      cleanup();
      reject(new Error(`Subprocess error for "${spec.command}": ${err.message}`));
    });

    child.on('close', (code) => {
      cleanup();
      if (isTerminated) {
        reject(new Error(`Subprocess "${spec.command}" was aborted or timed out`));
      } else {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      }
    });
  });
}

/**
 * Cleanly terminates a process: SIGTERM -> grace period -> SIGKILL
 */
export function terminateProcess(pid: number | undefined, gracePeriodMs = 2000): void {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Process might have already exited
    return;
  }

  setTimeout(() => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone
    }
  }, gracePeriodMs);
}
