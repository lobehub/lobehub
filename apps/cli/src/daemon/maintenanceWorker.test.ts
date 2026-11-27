import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MaintenanceConfig, runMaintenanceWorker } from './maintenanceWorker';

let directory: string;
let config: MaintenanceConfig;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'cli-maintenance-'));
  config = {
    entry: path.join(directory, 'entry.mjs'),
    executable: process.execPath,
    operation: {
      fromInstanceId: 'old',
      id: 'one',
      kind: 'restart',
      stage: 'restarting',
      targetVersion: '1.2.3',
    },
    parentPid: process.pid,
    receiptPath: path.join(directory, 'receipt.json'),
    restartArgs: [
      'connect',
      '--workspace',
      'workspace-42',
      '--public',
      '--gateway',
      'wss://gateway.test',
      '--device-id',
      'custom device',
    ],
    statePath: path.join(directory, 'state.json'),
  };
  await writeFile(
    config.entry,
    `import { writeFileSync } from 'node:fs';
if (process.argv[2] === '--version') console.log('1.2.3');
else writeFileSync(${JSON.stringify(path.join(directory, 'args.json'))}, JSON.stringify(process.argv.slice(2)));`,
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { force: true, recursive: true });
});

describe('independent CLI maintenance worker', () => {
  it('keeps the old connection alive when installation fails', async () => {
    config.install = { command: process.execPath, args: ['-e', 'process.exit(7)'] };
    const ready = vi.fn();
    await expect(runMaintenanceWorker(config, ready)).rejects.toThrow('failed (7)');
    expect(ready).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(config.statePath, 'utf8'))).toMatchObject({
      stage: 'failed',
      id: 'one',
    });
    expect(await readFile(config.receiptPath, 'utf8')).toBe(
      await readFile(config.statePath, 'utf8'),
    );
  });

  it('installs under the shared install lock and releases it', async () => {
    const lock = path.join(directory, 'auto-update.lock');
    const seen = path.join(directory, 'lock-seen');
    config.installLock = { path: lock, staleMs: 60_000 };
    config.install = {
      command: process.execPath,
      args: ['-e', `require('fs').copyFileSync(${JSON.stringify(lock)}, ${JSON.stringify(seen)})`],
    };
    config.restartArgs = undefined;
    config.parentPid = 2 ** 22 + 12_345;
    await runMaintenanceWorker(config, vi.fn());
    await expect(access(seen)).resolves.toBeUndefined();
    await expect(access(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not install while another installer holds the lock, and takes over a stale one', async () => {
    const lock = path.join(directory, 'auto-update.lock');
    config.installLock = { path: lock, staleMs: 60_000 };
    config.install = { command: process.execPath, args: ['-e', 'process.exit(7)'] };
    await writeFile(lock, '123');
    await expect(runMaintenanceWorker(config, vi.fn())).rejects.toThrow('Another CLI update');
    expect(await readFile(lock, 'utf8')).toBe('123');

    const old = new Date(Date.now() - 120_000);
    await utimes(lock, old, old);
    await expect(runMaintenanceWorker(config, vi.fn())).rejects.toThrow('failed (7)');
  });

  it('does not stop the daemon if the installed entry reports the wrong version', async () => {
    config.operation.targetVersion = '1.2.4';
    const ready = vi.fn();
    await expect(runMaintenanceWorker(config, ready)).rejects.toThrow('did not match');
    expect(ready).not.toHaveBeenCalled();
    await expect(readFile(path.join(directory, 'args.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('waits for the old process to exit and preserves workspace, public and custom connection args', async () => {
    const old = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    await once(old, 'spawn');
    config.parentPid = old.pid!;
    const exited = once(old, 'exit');
    try {
      await runMaintenanceWorker(config, () => old.kill('SIGTERM'));
      await exited;
      expect(JSON.parse(await readFile(path.join(directory, 'args.json'), 'utf8'))).toEqual([
        'connect',
        '--workspace',
        'workspace-42',
        '--public',
        '--gateway',
        'wss://gateway.test',
        '--device-id',
        'custom device',
        '--daemon',
      ]);
      expect(JSON.parse(await readFile(config.statePath, 'utf8')).stage).toBe('restarting');
    } finally {
      if (old.exitCode === null && old.signalCode === null) old.kill('SIGTERM');
    }
  });

  it('leaves the replacement to systemd when there are no daemon relaunch arguments', async () => {
    const old = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    await once(old, 'spawn');
    config.parentPid = old.pid!;
    config.restartArgs = undefined;
    try {
      await runMaintenanceWorker(config, () => old.kill('SIGTERM'));
      await expect(readFile(path.join(directory, 'args.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(JSON.parse(await readFile(config.statePath, 'utf8')).stage).toBe('restarting');
    } finally {
      if (old.exitCode === null && old.signalCode === null) old.kill('SIGTERM');
    }
  });
});
