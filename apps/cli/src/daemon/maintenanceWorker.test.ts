import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
});
