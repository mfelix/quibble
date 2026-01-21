import { spawn } from 'node:child_process';
import { execa, type Options as ExecaOptions } from 'execa';
import { withRetry, isTransientError } from '../utils/retry.js';

export interface ClientOptions {
  workingDirectory: string;
  timeoutMs: number;
}

export type StreamingCallback = (line: string) => void;

export abstract class BaseClient {
  protected options: ClientOptions;

  constructor(options: Partial<ClientOptions> = {}) {
    this.options = {
      workingDirectory: process.cwd(),
      timeoutMs: 15 * 60 * 1000, // 15 minutes - Opus needs more time for complex prompts
      ...options,
    };
  }

  protected async exec(
    command: string,
    args: string[],
    execaOptions: ExecaOptions = {}
  ): Promise<string> {
    const operation = async () => {
      const result = await execa(command, args, {
        cwd: this.options.workingDirectory,
        timeout: this.options.timeoutMs,
        reject: true,
        ...execaOptions,
      });

      return result.stdout as string;
    };

    return withRetry(operation, isTransientError, {
      maxAttempts: 3,
      baseDelayMs: 1000,
    });
  }

  /**
   * Execute a command with streaming stdout, calling onData for each line.
   * Returns the final stdout when the process completes.
   */
  protected async execStreaming(
    command: string,
    args: string[],
    onData: StreamingCallback,
    onChunk?: (source: 'stdout' | 'stderr', chunk: string) => void
  ): Promise<string> {
    const operation = () => new Promise<string>((resolve, reject) => {
      const subprocess = spawn(command, args, {
        cwd: this.options.workingDirectory,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      subprocess.stdin?.end();

      let stdout = '';
      let stderr = '';
      let lineBuffer = '';
      let stderrBuffer = '';

      // Use an inactivity timeout so long-running streams don't get killed mid-output.
      let timeoutId: NodeJS.Timeout | null = null;
      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          subprocess.kill('SIGTERM');
          reject(new Error(`Command timed out after ${this.options.timeoutMs} milliseconds: ${command} ${args.join(' ')}`));
        }, this.options.timeoutMs);
      };
      resetTimeout();

      subprocess.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        lineBuffer += text;
        if (onChunk) onChunk('stdout', text);
        resetTimeout();

        // Process complete lines
        const lines = lineBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) {
            onData(line);
          }
        }
      });

      subprocess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuffer += text;
        if (onChunk) onChunk('stderr', text);
        resetTimeout();

        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.trim()) {
            onData(line);
          }
        }
      });

      subprocess.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);

        // Process any remaining data in the buffer
        if (lineBuffer.trim()) {
          onData(lineBuffer);
        }
        if (stderrBuffer.trim()) {
          onData(stderrBuffer);
        }

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr || stdout}`));
        }
      });

      subprocess.on('error', (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        reject(err);
      });
    });

    return withRetry(operation, isTransientError, {
      maxAttempts: 3,
      baseDelayMs: 1000,
    });
  }
}
