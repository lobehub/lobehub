import { spawn } from 'node:child_process';

import type { RunCommandParams, RunCommandResult } from '../types';
import type { ShellOutputFiles, ShellProcess, ShellProcessManager } from './process-manager';
import { getShellConfig } from './utils';

export interface RunCommandOptions {
  logger?: {
    debug: (...args: any[]) => void;
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
  };
  processManager: ShellProcessManager;
}

export async function runCommand(
  {
    command,
    cwd,
    description,
    env: extraEnv,
    run_in_background,
    timeout = 30_000,
  }: RunCommandParams,
  { processManager, logger }: RunCommandOptions,
): Promise<RunCommandResult> {
  if (!command) {
    return { error: 'command is required', success: false };
  }

  const logPrefix = `[runCommand: ${description || command.slice(0, 50)}]`;
  logger?.debug(`${logPrefix} Starting`, { background: run_in_background, cwd, timeout });

  const shellConfig = getShellConfig(command);
  const childEnv = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  let outputFiles: ShellOutputFiles | undefined;

  try {
    const shellId = processManager.createShellId();
    const shellOutputFiles = processManager.createOutputFiles(shellId);
    outputFiles = shellOutputFiles;
    const childProcess = spawn(shellConfig.cmd, shellConfig.args, {
      cwd,
      detached: process.platform !== 'win32',
      env: childEnv,
      shell: false,
      stdio: ['pipe', shellOutputFiles.stdout.fd, shellOutputFiles.stderr.fd],
    });

    const shellProcess: ShellProcess = {
      exitCode: null,
      outputFiles: shellOutputFiles,
      process: childProcess,
    };

    childProcess.on('exit', (code) => {
      logger?.debug(`${logPrefix} Process exited`, { code, shellId });
      shellProcess.exitCode = code ?? 0;
    });

    childProcess.on('error', (error) => {
      logger?.error(`${logPrefix} Command failed:`, error);
      shellProcess.exitCode = 1;
    });

    processManager.register(shellId, shellProcess);
    // Close our fd copy only after error/close listeners are registered; spawn errors are asynchronous.
    processManager.closeOutputFiles(shellOutputFiles);
    logger?.info?.(`${logPrefix} Started session`, { background: run_in_background, shellId });

    if (run_in_background) {
      return {
        output: '',
        output_files: processManager.getOutputFilesInfo(shellOutputFiles),
        shell_id: shellId,
        success: true,
      };
    }

    const observation = await processManager.getRunCommandOutput({
      shell_id: shellId,
      timeout,
    });

    return {
      ...observation,
      shell_id: shellId,
    };
  } catch (error) {
    if (outputFiles) processManager.closeOutputFiles(outputFiles);
    return { error: (error as Error).message, success: false };
  }
}
