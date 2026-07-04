import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import treeKill from 'tree-kill';

import type { GetCommandOutputParams, GetCommandOutputResult, KillCommandResult } from '../types';
import { buildOutputPreview } from './utils';

const DEFAULT_OBSERVATION_TIMEOUT_MS = 30_000;
const MAX_OBSERVATION_TIMEOUT_MS = 120_000;
const RUN_COMMAND_HEAD_RATIO = 0.2;
const GET_COMMAND_OUTPUT_HEAD_RATIO = 0;
const OUTPUT_PREVIEW_TOTAL_MAX_BYTES = 22 * 1024;
const OUTPUT_PREVIEW_STREAM_MAX_BYTES = 18 * 1024;
const OUTPUT_PREVIEW_SECONDARY_MIN_BYTES = 4 * 1024;
const KILL_SIGNAL: NodeJS.Signals = 'SIGKILL';

export interface ShellOutputFile {
  fd: number;
  /** Tracks the parent fd only; child stdio close is tracked by ShellProcess.closedAt. */
  fdClosed?: boolean;
  path: string;
}

export interface ShellOutputFiles {
  stderr: ShellOutputFile;
  stdout: ShellOutputFile;
}

export interface ShellProcess {
  closed?: Promise<void>;
  closedAt?: number;
  endedAt?: number;
  exitCode: number | null;
  outputFiles: ShellOutputFiles;
  process: ChildProcess;
  startedAt?: number;
}

export class ShellProcessManager {
  private nextShellId = 1;

  private readonly outputRunDir: string;

  private processes = new Map<string, ShellProcess>();

  constructor(outputRoot?: string) {
    const date = new Date();

    this.outputRunDir = path.join(
      path.resolve(outputRoot ?? path.join(os.tmpdir(), 'lobehub', 'shell')),
      `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      process.pid.toString(),
    );
    fs.mkdirSync(this.outputRunDir, { mode: 0o700, recursive: true });
  }

  createShellId(): string {
    return `sh-${this.nextShellId++}`;
  }

  createOutputFiles(shellId: string): ShellOutputFiles {
    const outputDir = path.join(this.outputRunDir, shellId);
    fs.mkdirSync(outputDir, { mode: 0o700, recursive: true });

    return {
      stderr: this.createOutputFile(path.join(outputDir, 'stderr.log')),
      stdout: this.createOutputFile(path.join(outputDir, 'stdout.log')),
    };
  }

  createOutputFile(outputPath: string): ShellOutputFile {
    const fd =
      process.platform === 'win32'
        ? fs.openSync(outputPath, 'w', 0o600)
        : fs.openSync(
            outputPath,
            fs.constants.O_APPEND |
              fs.constants.O_CREAT |
              fs.constants.O_TRUNC |
              fs.constants.O_WRONLY |
              (fs.constants.O_NOFOLLOW ?? 0),
            0o600,
          );

    return {
      fd,
      path: outputPath,
    };
  }

  getOutputFilesInfo(outputFiles: ShellOutputFiles): GetCommandOutputResult['output_files'] {
    return {
      stderr: this.getOutputFileInfo(outputFiles.stderr),
      stdout: this.getOutputFileInfo(outputFiles.stdout),
    };
  }

  register(shellId: string, shellProcess: ShellProcess): void {
    shellProcess.startedAt ??= Date.now();
    if (shellProcess.exitCode !== null || shellProcess.process.exitCode !== null) {
      shellProcess.endedAt ??= Date.now();
    }

    const markEnded = () => {
      shellProcess.endedAt ??= Date.now();
    };

    shellProcess.process.once('exit', markEnded);
    shellProcess.process.once('error', markEnded);
    // Wait for the child stdio streams to close before reading the final output.
    // The process may emit "exit" before inherited streams finish flushing.
    shellProcess.closed =
      shellProcess.closedAt === undefined
        ? new Promise<void>((resolve) => {
            shellProcess.process.once('close', () => {
              shellProcess.closedAt ??= Date.now();
              shellProcess.endedAt ??= shellProcess.closedAt;
              this.closeOutputFiles(shellProcess.outputFiles);
              resolve();
            });
          })
        : Promise.resolve();
    this.processes.set(shellId, shellProcess);
  }

  async getRunCommandOutput(params: GetCommandOutputParams): Promise<GetCommandOutputResult> {
    return this.observeOutput(params, RUN_COMMAND_HEAD_RATIO);
  }

  async getOutput(params: GetCommandOutputParams): Promise<GetCommandOutputResult> {
    return this.observeOutput(params, GET_COMMAND_OUTPUT_HEAD_RATIO);
  }

  private async observeOutput(
    { filter, shell_id, timeout }: GetCommandOutputParams,
    headRatio: number,
  ): Promise<GetCommandOutputResult> {
    const shellProcess = this.processes.get(shell_id);
    if (!shellProcess) {
      return {
        error: `Shell ID ${shell_id} not found`,
        output: '',
        stderr: '',
        stdout: '',
        success: false,
      };
    }

    const { process: childProcess } = shellProcess;

    let exitCode = childProcess.exitCode ?? shellProcess.exitCode;
    if (exitCode === null) {
      const waitTimeout =
        typeof timeout === 'number' && Number.isFinite(timeout)
          ? Math.min(Math.max(Math.trunc(timeout), 0), MAX_OBSERVATION_TIMEOUT_MS)
          : DEFAULT_OBSERVATION_TIMEOUT_MS;

      if (waitTimeout > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onError: (() => void) | undefined;
        let onExit: (() => void) | undefined;

        try {
          await Promise.race([
            new Promise<void>((resolve) => {
              onError = resolve;
              childProcess.once('error', onError);
            }),
            new Promise<void>((resolve) => {
              onExit = resolve;
              childProcess.once('exit', onExit);
            }),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, waitTimeout);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          if (onError) childProcess.off('error', onError);
          if (onExit) childProcess.off('exit', onExit);
        }
      }
    }

    exitCode = childProcess.exitCode ?? shellProcess.exitCode;
    if (exitCode !== null) {
      shellProcess.endedAt ??= Date.now();
      await shellProcess.closed;
    }

    const stdoutFileInfo = this.getOutputFileInfo(shellProcess.outputFiles.stdout);
    const stderrFileInfo = this.getOutputFileInfo(shellProcess.outputFiles.stderr);
    const previewBytes = allocateOutputPreviewBytes(stdoutFileInfo.size, stderrFileInfo.size);
    const stdoutPreview = buildOutputPreview(
      shellProcess.outputFiles.stdout.path,
      headRatio,
      previewBytes.stdout,
    );
    const stderrPreview = buildOutputPreview(
      shellProcess.outputFiles.stderr.path,
      headRatio,
      previewBytes.stderr,
    );
    let stdout = stdoutPreview.content;
    let stderr = stderrPreview.content;

    if (filter) {
      try {
        const regex = new RegExp(filter, 'm');
        stdout = stdout
          .split('\n')
          .filter((line) => regex.test(line))
          .join('\n');
        stderr = stderr
          .split('\n')
          .filter((line) => regex.test(line))
          .join('\n');
      } catch {
        // Invalid filter regex, use unfiltered output
      }
    }

    const startedAt = shellProcess.startedAt ?? Date.now();
    const durationMs = Math.max(0, (shellProcess.endedAt ?? Date.now()) - startedAt);

    return {
      duration_ms: durationMs,
      exit_code: exitCode ?? undefined,
      output: stdout + stderr,
      output_files: {
        stderr: {
          path: shellProcess.outputFiles.stderr.path,
          size: stderrPreview.size,
          truncated: stderrPreview.truncated,
        },
        stdout: {
          path: shellProcess.outputFiles.stdout.path,
          size: stdoutPreview.size,
          truncated: stdoutPreview.truncated,
        },
      },
      stderr,
      stdout,
      success: true,
    };
  }

  kill(shell_id: string): KillCommandResult {
    const shellProcess = this.processes.get(shell_id);
    if (!shellProcess) {
      return { error: `Shell ID ${shell_id} not found`, success: false };
    }

    try {
      killProcessTree(shellProcess.process);
      this.closeOutputFiles(shellProcess.outputFiles);
      this.processes.delete(shell_id);
      return { success: true };
    } catch (error) {
      return { error: (error as Error).message, success: false };
    }
  }

  cleanupAll(): void {
    for (const [id, sp] of this.processes) {
      try {
        killProcessTree(sp.process);
      } catch {
        // Ignore
      }
      this.closeOutputFiles(sp.outputFiles);
      this.processes.delete(id);
    }
  }

  closeOutputFiles(outputFiles: ShellOutputFiles): void {
    for (const outputFile of [outputFiles.stdout, outputFiles.stderr]) {
      if (outputFile.fdClosed) continue;
      outputFile.fdClosed = true;
      try {
        fs.closeSync(outputFile.fd);
      } catch {
        // Ignore repeated close attempts.
      }
    }
  }

  private getOutputFileInfo(
    outputFile: ShellOutputFile,
  ): NonNullable<GetCommandOutputResult['output_files']>['stdout'] {
    let size = 0;
    try {
      size = fs.statSync(outputFile.path).size;
    } catch {
      // Keep the metadata shape stable even if the file was removed externally.
    }

    return {
      path: outputFile.path,
      size,
      truncated: false,
    };
  }
}

const killProcessTree = (childProcess: ChildProcess): void => {
  const { pid } = childProcess;

  if (pid) {
    treeKill(pid, KILL_SIGNAL);
    return;
  }

  childProcess.kill(KILL_SIGNAL);
};

// Keep the inline preview under the model-facing budget while preserving both
// streams when stdout and stderr are both present.
const allocateOutputPreviewBytes = (
  stdoutSize: number,
  stderrSize: number,
): { stderr: number; stdout: number } => {
  if (stdoutSize + stderrSize <= OUTPUT_PREVIEW_TOTAL_MAX_BYTES) {
    return { stderr: stderrSize, stdout: stdoutSize };
  }

  if (stdoutSize <= 0) {
    return { stderr: Math.min(stderrSize, OUTPUT_PREVIEW_STREAM_MAX_BYTES), stdout: 0 };
  }

  if (stderrSize <= 0) {
    return { stderr: 0, stdout: Math.min(stdoutSize, OUTPUT_PREVIEW_STREAM_MAX_BYTES) };
  }

  const stdoutIsPrimary = stdoutSize >= stderrSize;
  const primarySize = stdoutIsPrimary ? stdoutSize : stderrSize;
  const secondarySize = stdoutIsPrimary ? stderrSize : stdoutSize;
  const secondaryBudget = Math.min(secondarySize, OUTPUT_PREVIEW_SECONDARY_MIN_BYTES);
  const primaryBudget = Math.min(
    primarySize,
    OUTPUT_PREVIEW_STREAM_MAX_BYTES,
    OUTPUT_PREVIEW_TOTAL_MAX_BYTES - secondaryBudget,
  );

  return stdoutIsPrimary
    ? { stderr: secondaryBudget, stdout: primaryBudget }
    : { stderr: primaryBudget, stdout: secondaryBudget };
};
