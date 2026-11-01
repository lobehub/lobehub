import type * as ChildProcessModule from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliMaintenance } from './maintenance';

const { spawn, child } = vi.hoisted(() => {
  return {
    child: {
      value: undefined as unknown as EventEmitter & {
        connected: boolean;
        send: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
      },
    },
    spawn: vi.fn(),
  };
});
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof ChildProcessModule>()),
  spawn,
}));

let home: string;
let originalArgv: string[];
const id = '82f26ff2-0ddc-4ddf-b633-6dd5219a3b47';
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'cli-maintenance-gate-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  await mkdir(path.join(home, 'dist'));
  await writeFile(path.join(home, 'dist', 'index.js'), '');
  await writeFile(path.join(home, 'dist', 'maintenanceWorker.mjs'), '');
  originalArgv = process.argv;
  process.argv = [process.execPath, path.join(home, 'dist', 'index.js')];
  child.value = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn(),
    unref: vi.fn(),
  });
  spawn.mockReturnValue(child.value);
});
afterEach(async () => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await rm(home, { force: true, recursive: true });
});
const create = (activeTasks = () => 0, daemon = true) =>
  new CliMaintenance({
    activeTasks,
    daemon,
    restartArgs: ['connect', '--workspace', 'workspace-a', '--public'],
    shutdown: vi.fn(),
  });

describe('CLI maintenance admission', () => {
  it('makes historical operations recoverable after a manual version change', async () => {
    const maintenance = create();
    const state = await maintenance.restart({ requestId: id, update: false });
    const operation = { ...state.operation!, targetVersion: '0.0.0' };
    await writeFile(
      path.join(home, '.lobehub/cli-maintenance/state.json'),
      JSON.stringify(operation),
    );

    // An update in the originating process is still in flight, not a failure.
    expect((await maintenance.getState()).operation?.stage).toBe('restarting');
    const reconnected = await create().getState();
    expect(reconnected.operation).toMatchObject({
      id,
      stage: 'failed',
      error: expect.stringContaining('different CLI version'),
    });
    expect(reconnected.supported).toBe(true);
  });

  it('rejects background tasks and releases the gate after refusal', async () => {
    const maintenance = create(() => 2);
    await expect(maintenance.restart({ requestId: id, update: false })).rejects.toThrow(
      'active tasks',
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(await maintenance.run(async () => 'available')).toBe('available');
  });

  it('counts an in-flight request and rejects a restart before it finishes', async () => {
    const maintenance = create();
    let finish!: () => void;
    const running = maintenance.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await expect(maintenance.restart({ requestId: id, update: false })).rejects.toThrow(
      'active tasks',
    );
    finish();
    await running;
    expect((await maintenance.getState()).activeTasks).toBe(0);
  });

  it('starts only after acknowledgement, blocks new work, and deduplicates across processes', async () => {
    const maintenance = create();
    const state = await maintenance.restart({ requestId: id, update: false });
    expect(state.operation?.id).toBe(id);
    expect(child.value.send).not.toHaveBeenCalled();
    maintenance.afterResponse();
    maintenance.afterResponse();
    expect(child.value.send).toHaveBeenCalledTimes(1);
    await expect(maintenance.run(async () => true)).rejects.toThrow('updating or restarting');
    await maintenance.restart({ requestId: id, update: false });
    const restarted = create();
    expect((await restarted.restart({ requestId: id, update: false })).operation?.id).toBe(id);
    expect(spawn).toHaveBeenCalledTimes(1);
    const config = JSON.parse(
      await readFile(path.join(home, '.lobehub/cli-maintenance', `${id}.config.json`), 'utf8'),
    );
    expect(config.restartArgs).toEqual(['connect', '--workspace', 'workspace-a', '--public']);
  });

  it('does not support foreground connections or unchecked updates', async () => {
    expect((await create(undefined, false).getState()).supported).toBe(false);
    await expect(create().restart({ requestId: id, update: true })).rejects.toThrow(
      'Check for updates',
    );
    expect(spawn).not.toHaveBeenCalled();
  });
});
