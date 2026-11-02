import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  type AuvRunCommandParams,
  normalizeAuvArgv,
  runAuvCommand,
  toAuvToolOutput,
} from '@lobechat/device-control/computer-use';

import { CLI_CONFIG_DIR_NAME } from '../constants/identity';

const execFileAsync = promisify(execFile);

/** How this device runs Computer Use: an `auv` binary the user provided. */
export interface ComputerUseDevice {
  binaryPath: string;
  /** AUV run store for this device's commands; image artifacts are read from here. */
  storeRoot: string;
}

// Matches the tool manifest's `defaultTimeoutMs` for `runCommand`.
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Enables Computer Use for `lh connect --auv <binary>`. Returns `undefined`
 * without `--auv`, so the device does not advertise the tool.
 *
 * `lh` only runs `auv invoke`; the AUV daemon it reaches (default local
 * endpoint or `AUV_ENDPOINT`) is the user's to start, unlike the desktop app,
 * which owns a private daemon.
 *
 * NOTICE: on macOS, Accessibility and Screen Recording are granted to the
 * process that launches `auv` — the terminal for a foreground `lh connect`,
 * nobody for a launchd/daemon one. Only Linux has been verified. Delegating
 * those permissions to a signed AUV helper app is not done here.
 */
export const resolveComputerUseDevice = async (
  binary: string | undefined,
): Promise<ComputerUseDevice | undefined> => {
  if (!binary) return undefined;

  const binaryPath = path.resolve(binary);
  const stats = await stat(binaryPath).catch(() => undefined);
  if (!stats?.isFile()) throw new Error(`--auv: no file at ${binaryPath}`);
  await access(binaryPath, constants.X_OK).catch(() => {
    throw new Error(`--auv: ${binaryPath} is not executable`);
  });

  return {
    binaryPath,
    storeRoot: path.join(os.homedir(), CLI_CONFIG_DIR_NAME, 'auv', 'runs'),
  };
};

/**
 * Runs one `lobe-computer-use` tool call with the device's `auv` binary and
 * returns the same tool result the desktop app does.
 */
export const executeComputerUseCall = async (
  device: ComputerUseDevice | undefined,
  apiName: string,
  argsStr: string,
  timeout?: number,
) => {
  try {
    if (!device) {
      throw new Error(
        'Computer Use is not enabled on this device. Restart `lh connect` with --auv <binary>.',
      );
    }
    if (apiName !== 'runCommand') {
      throw new Error(`Computer Use tool "${apiName}" is not available on this device`);
    }

    const params = JSON.parse(argsStr) as AuvRunCommandParams;
    const argv = normalizeAuvArgv(params);
    const result = await runAuvCommand(params, argv, (cliArgv) =>
      execFileAsync(device.binaryPath, [...cliArgv, '--store-root', device.storeRoot], {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      }),
    );
    return toAuvToolOutput(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', error: message, state: undefined, success: false };
  }
};
