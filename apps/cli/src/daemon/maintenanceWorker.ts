import { execFile, spawn } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import type { DeviceCliUpdateOperation } from '@lobechat/types';

export interface MaintenanceConfig {
  entry: string;
  executable: string;
  install?: { args: string[]; command: string };
  operation: DeviceCliUpdateOperation;
  parentPid: number;
  receiptPath: string;
  restartArgs: string[];
  statePath: string;
}

/** Atomic replacement lets the connected daemon read progress during installation. */
export async function writeMaintenanceState(file: string, operation: DeviceCliUpdateOperation) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(operation), { mode: 0o600 });
  await rename(temporary, file);
}

async function run(command: string, args: string[], timeout: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', timeout });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`CLI maintenance command failed (${signal ?? code}). See lh connect logs.`),
        );
    });
  });
}

/** Runs from a private copy outside the package being replaced. No runtime package imports. */
export async function runMaintenanceWorker(config: MaintenanceConfig, ready: () => void) {
  const { entry, executable, operation, statePath } = config;
  const persist = async () => {
    await writeMaintenanceState(config.receiptPath, operation);
    await writeMaintenanceState(statePath, operation);
  };
  try {
    if (config.install) await run(config.install.command, config.install.args, 180_000);

    // Do not stop a working connection unless the new executable can actually start.
    const { stdout } = await promisify(execFile)(executable, [entry, '--version'], {
      timeout: 30_000,
    });
    if (stdout.trim() !== operation.targetVersion) {
      throw new Error(
        'Installed CLI version did not match the requested version. The existing connection was kept.',
      );
    }
    operation.stage = 'restarting';
    await persist();
    ready();

    const deadline = Date.now() + 30_000;
    while (true) {
      try {
        process.kill(config.parentPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') break;
        throw error;
      }
      if (Date.now() >= deadline)
        throw new Error('The previous CLI did not stop. No second daemon was started.');
      await delay(100);
    }
    // The normal daemon launcher waits for startup preflight and writes its own PID.
    // Preserve argv as an array: paths and workspace flags never pass through a shell.
    await run(executable, [entry, ...config.restartArgs, '--daemon'], 45_000);
  } catch (error) {
    operation.stage = 'failed';
    operation.error = error instanceof Error ? error.message : String(error);
    await persist();
    throw error;
  }
}

if (process.argv[2] === '--maintenance-config') {
  const configPath = process.argv[3];
  // The config can carry an explicit connect token. Remove it immediately after reading.
  const config = JSON.parse(await readFile(configPath, 'utf8')) as MaintenanceConfig;
  await rm(configPath);
  let started = false;
  const timeout = setTimeout(() => process.disconnect?.(), 15_000);
  process.once('message', () => {
    started = true;
    clearTimeout(timeout);
    void runMaintenanceWorker(config, () => {
      if (!process.connected)
        throw new Error(
          'The original daemon stopped during installation. Start the connection manually.',
        );
      process.send?.({ type: 'ready-to-restart' });
    })
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      })
      .finally(async () => {
        if (process.connected) process.disconnect();
        await rm(process.argv[1], { force: true });
      });
  });
  // A parent disappearing before it acknowledges the request must not leave an idle helper.
  process.once('disconnect', () => {
    clearTimeout(timeout);
    if (!started) {
      process.exitCode = 1;
      void rm(process.argv[1], { force: true }).catch(console.error);
    }
  });
}
