import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  DeviceCliRestartParams,
  DeviceCliUpdateOperation,
  DeviceCliUpdateState,
} from '@lobechat/types';
import semver from 'semver';

import {
  buildInstallCommand,
  detectPackageManager,
  fetchLatestVersion,
  isNewerVersion,
} from '../commands/update';
import { CLI_CONFIG_DIR_NAME } from '../constants/identity';
import { cliPackageName, cliVersion } from '../pkg';
import { type MaintenanceConfig, writeMaintenanceState } from './maintenanceWorker';
import { getLogPath } from './manager';

const MAINTENANCE_MESSAGE = 'The CLI is updating or restarting. Retry after it reconnects.';

/** One gate shared by every workspace connection owned by this process. */
export class CliMaintenance {
  private readonly instanceId = randomUUID();
  private readonly directory = path.join(os.homedir(), CLI_CONFIG_DIR_NAME, 'cli-maintenance');
  private readonly statePath = path.join(this.directory, 'state.json');
  private activeRequests = 0;
  private locked = false;
  private child?: ChildProcess;
  private acknowledged = false;
  private latestVersion?: string;

  constructor(
    private readonly options: {
      activeTasks: () => number;
      daemon: boolean;
      restartArgs: string[];
      shutdown: () => Promise<void>;
    },
  ) {}

  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.locked) throw new Error(MAINTENANCE_MESSAGE);
    this.activeRequests++;
    try {
      return await action();
    } finally {
      this.activeRequests--;
    }
  }

  private async readOperation(
    file = this.statePath,
  ): Promise<DeviceCliUpdateOperation | undefined> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as DeviceCliUpdateOperation;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async workerPath() {
    const entry = await realpath(process.argv[1]);
    const worker = path.join(path.dirname(entry), 'maintenanceWorker.mjs');
    await stat(worker);
    return worker;
  }

  getState = async (): Promise<DeviceCliUpdateState> => {
    let supported = this.options.daemon && process.platform !== 'win32';
    try {
      if (supported) await this.workerPath();
    } catch {
      supported = false;
    }
    let operation = await this.readOperation();
    // A replacement process on a different version cannot complete this receipt.
    // Surface failure so a historical request does not permanently lock the UI.
    if (
      operation &&
      operation.stage !== 'failed' &&
      operation.fromInstanceId !== this.instanceId &&
      operation.targetVersion !== cliVersion
    ) {
      operation = {
        ...operation,
        error:
          'The device reconnected on a different CLI version. Check for updates before retrying.',
        stage: 'failed',
      };
    }
    return {
      activeTasks: this.activeRequests + this.options.activeTasks(),
      currentVersion: cliVersion,
      instanceId: this.instanceId,
      latestVersion: this.latestVersion,
      operation,
      supported,
      unsupportedReason: supported
        ? undefined
        : 'Use an installed CLI with lh connect --daemon on macOS or Linux. Foreground and system-service connections must be maintained on the device.',
    };
  };

  check = async (): Promise<DeviceCliUpdateState> => {
    if (this.locked) return this.getState();
    const latest = await fetchLatestVersion(cliPackageName, 'latest');
    if (!semver.valid(latest))
      throw new Error('The package registry returned an invalid CLI version.');
    if (this.locked) return this.getState();
    this.latestVersion = isNewerVersion(latest, cliVersion) ? latest : undefined;
    await rm(this.statePath, { force: true });
    return this.getState();
  };

  restart = async ({
    requestId,
    update,
  }: DeviceCliRestartParams): Promise<DeviceCliUpdateState> => {
    // Also validate at the device boundary; requests must never choose a filesystem path.
    if (
      !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId) ||
      typeof update !== 'boolean'
    ) {
      throw new Error('Invalid CLI maintenance request');
    }
    if (this.locked) return this.getState();
    this.locked = true;
    const receipt = path.join(this.directory, `${requestId}.json`);
    try {
      const previous = await this.readOperation(receipt);
      if (previous) {
        this.locked = false;
        return { ...(await this.getState()), operation: previous };
      }
      const state = await this.getState();
      if (!state.supported) throw new Error(state.unsupportedReason);
      if (state.activeTasks > 0)
        throw new Error('This device has active tasks. Wait for them to finish before restarting.');
      if (update && !this.latestVersion)
        throw new Error('Check for updates before updating this CLI.');
      const operation: DeviceCliUpdateOperation = {
        fromInstanceId: this.instanceId,
        id: requestId,
        kind: update ? 'update' : 'restart',
        stage: update ? 'updating' : 'restarting',
        targetVersion: update ? this.latestVersion! : cliVersion,
      };
      await mkdir(this.directory, { mode: 0o700, recursive: true });
      const worker = path.join(this.directory, `${requestId}.mjs`);
      const configPath = path.join(this.directory, `${requestId}.config.json`);
      await copyFile(await this.workerPath(), worker);
      const config: MaintenanceConfig = {
        entry: process.argv[1],
        executable: process.execPath,
        install: update
          ? buildInstallCommand(
              detectPackageManager(),
              `${cliPackageName}@${operation.targetVersion}`,
            )
          : undefined,
        operation,
        parentPid: process.pid,
        receiptPath: receipt,
        restartArgs: this.options.restartArgs,
        statePath: this.statePath,
      };
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      await writeFile(receipt, JSON.stringify(operation), { flag: 'wx', mode: 0o600 });
      await writeMaintenanceState(this.statePath, operation);
      const failed = async (message: string) => {
        const latest = await this.readOperation();
        if (latest?.id === requestId && latest.stage !== 'failed') {
          const failure: DeviceCliUpdateOperation = {
            ...operation,
            error: message,
            stage: 'failed',
          };
          await writeMaintenanceState(receipt, failure);
          await writeMaintenanceState(this.statePath, failure);
        }
        await rm(configPath, { force: true });
        await rm(worker, { force: true });
        this.locked = false;
      };
      const log = await open(getLogPath(), 'a', 0o600);
      try {
        this.child = spawn(process.execPath, [worker, '--maintenance-config', configPath], {
          detached: true,
          stdio: ['ignore', log.fd, log.fd, 'ipc'],
        });
        // Register before yielding: spawn errors can arrive while closing our log FD.
        this.child.once('error', (error) => void failed(error.message).catch(console.error));
        this.child.once(
          'exit',
          () =>
            void failed(
              'CLI maintenance stopped before the connection restarted. See lh connect logs.',
            ).catch(console.error),
        );
      } finally {
        await log.close();
      }
      this.acknowledged = false;
      const child = this.child;
      child.on('message', (message: { type: string }) => {
        if (message.type === 'ready-to-restart') {
          void this.options.shutdown().catch((error) => console.error('CLI restart failed', error));
        }
      });
      child.unref();
      return this.getState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        const saved = await this.readOperation(receipt);
        if (saved) {
          const failed: DeviceCliUpdateOperation = { ...saved, error: message, stage: 'failed' };
          await writeMaintenanceState(receipt, failed);
          await writeMaintenanceState(this.statePath, failed);
        }
      } finally {
        this.locked = false;
      }
      throw new Error(`CLI_MAINTENANCE_REJECTED: ${message}`, { cause: error });
    }
  };

  /** Called only after sending the restart RPC acknowledgement. */
  afterResponse() {
    if (!this.child?.connected || this.acknowledged) return;
    this.acknowledged = true;
    this.child.send({ type: 'start' });
  }
}
