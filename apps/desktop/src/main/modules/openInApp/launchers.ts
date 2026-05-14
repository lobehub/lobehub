import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { OpenInAppId, OpenInAppResult } from '@lobechat/electron-client-ipc';
import { shell } from 'electron';

import { createLogger } from '@/utils/logger';

import type { LaunchStrategy } from './registry';
import { APP_REGISTRY } from './registry';

const logger = createLogger('modules:openInApp:launchers');

const execFileAsync = promisify(execFile);

const SAFE_BINARY_REGEX = /^[\w.-]+$/;

const isAllowedBinary = (binary: string): boolean =>
  SAFE_BINARY_REGEX.test(binary) || path.isAbsolute(binary);

interface ExecError extends Error {
  stderr?: string;
}

const formatExecError = (error: unknown): string => {
  const err = error as ExecError;
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  const fallback = err?.message ?? 'Launch failed';
  return (stderr || fallback).slice(0, 200);
};

const runLaunchStrategy = async (
  strategy: LaunchStrategy,
  absolutePath: string,
): Promise<OpenInAppResult> => {
  switch (strategy.type) {
    case 'macOpenA': {
      try {
        await execFileAsync('open', ['-a', strategy.appName, absolutePath]);
        return { success: true };
      } catch (error) {
        return { error: formatExecError(error), success: false };
      }
    }
    case 'macOpen': {
      try {
        await execFileAsync('open', [absolutePath]);
        return { success: true };
      } catch (error) {
        return { error: formatExecError(error), success: false };
      }
    }
    case 'exec': {
      if (!isAllowedBinary(strategy.binary)) {
        return { error: 'Invalid binary name', success: false };
      }
      const extraArgs = strategy.args ?? [];
      try {
        await execFileAsync(strategy.binary, [...extraArgs, absolutePath]);
        return { success: true };
      } catch (error) {
        return { error: formatExecError(error), success: false };
      }
    }
    case 'shellOpenPath': {
      const result = await shell.openPath(absolutePath);
      return result ? { error: result, success: false } : { success: true };
    }
  }
};

export const launchApp = async (
  id: OpenInAppId,
  absolutePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<OpenInAppResult> => {
  const descriptor = APP_REGISTRY[id];
  const strategy = descriptor?.launch[platform];
  if (!descriptor || !strategy) {
    const displayName = descriptor?.displayName ?? id;
    return {
      error: `${displayName} is not available on this platform`,
      success: false,
    };
  }

  if (!path.isAbsolute(absolutePath)) {
    return { error: 'Path must be absolute', success: false };
  }

  try {
    await access(absolutePath);
  } catch {
    return { error: `Path not found: ${absolutePath}`, success: false };
  }

  const result = await runLaunchStrategy(strategy, absolutePath);
  if (result.success) {
    logger.info(`launched ${id} at ${absolutePath}`);
  } else {
    logger.error(`failed to launch ${id} at ${absolutePath}: ${result.error}`);
  }
  return result;
};
