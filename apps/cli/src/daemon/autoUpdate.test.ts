import type { DeviceCliUpdateState } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as autoUpdate from '../utils/autoUpdate';
import {
  DAEMON_UPDATE_CHECK_INTERVAL_MS,
  DAEMON_UPDATE_RETRY_INTERVAL_MS,
  DaemonAutoUpdater,
} from './autoUpdate';

const state = (overrides: Partial<DeviceCliUpdateState> = {}): DeviceCliUpdateState => ({
  activeTasks: 0,
  currentVersion: '1.0.0',
  instanceId: 'self',
  supported: true,
  ...overrides,
});

const setup = (initial: Partial<DeviceCliUpdateState> = {}, busy = false) => {
  let current = state(initial);
  let now = 0;
  const maintenance = {
    afterResponse: vi.fn(),
    check: vi.fn(async () => {
      current = { ...current, latestVersion: '1.1.0' };
      return current;
    }),
    getState: vi.fn(async () => current),
    restart: vi.fn(async () => current),
  };
  const updater = new DaemonAutoUpdater({
    isBusy: () => busy,
    log: vi.fn(),
    maintenance,
    now: () => now,
  });
  return {
    advance: (ms: number) => (now += ms),
    maintenance,
    set: (overrides: Partial<DeviceCliUpdateState>) => (current = { ...current, ...overrides }),
    updater,
  };
};

beforeEach(() => {
  vi.spyOn(autoUpdate, 'isAutoUpdateEnabled').mockReturnValue(true);
  vi.spyOn(autoUpdate, 'isInstallLockHeld').mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DaemonAutoUpdater', () => {
  it('installs a found release through the maintenance flow when idle', async () => {
    const { maintenance, updater } = setup();
    await updater.tick();
    expect(maintenance.check).toHaveBeenCalledTimes(1);
    expect(maintenance.restart).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[\da-f-]{36}$/),
      update: true,
    });
    expect(maintenance.afterResponse).toHaveBeenCalledTimes(1);
  });

  it('waits for running tasks and tunnels, then updates without asking the registry again', async () => {
    const tasks = setup({ activeTasks: 1 });
    await tasks.updater.tick();
    expect(tasks.maintenance.restart).not.toHaveBeenCalled();
    tasks.set({ activeTasks: 0 });
    tasks.advance(DAEMON_UPDATE_RETRY_INTERVAL_MS);
    await tasks.updater.tick();
    expect(tasks.maintenance.check).toHaveBeenCalledTimes(1);
    expect(tasks.maintenance.restart).toHaveBeenCalledTimes(1);

    const tunnels = setup({}, true);
    await tunnels.updater.tick();
    expect(tunnels.maintenance.restart).not.toHaveBeenCalled();
  });

  it('asks the registry again after an hour busy so it installs the newest release', async () => {
    const { advance, maintenance, set, updater } = setup({ activeTasks: 1 });
    await updater.tick();
    advance(DAEMON_UPDATE_CHECK_INTERVAL_MS);
    maintenance.check.mockResolvedValueOnce(state({ latestVersion: '1.2.0' }));
    set({ activeTasks: 0 });
    await updater.tick();
    expect(maintenance.check).toHaveBeenCalledTimes(2);
    expect(maintenance.restart).toHaveBeenCalledTimes(1);
  });

  it('waits while another installer holds the install lock', async () => {
    const { maintenance, updater } = setup();
    vi.mocked(autoUpdate.isInstallLockHeld).mockReturnValue(true);
    await updater.tick();
    expect(maintenance.restart).not.toHaveBeenCalled();
  });

  it('asks the registry at most once per check interval', async () => {
    const { advance, maintenance, updater } = setup();
    maintenance.check.mockResolvedValue(state());
    await updater.tick();
    advance(DAEMON_UPDATE_RETRY_INTERVAL_MS);
    await updater.tick();
    expect(maintenance.check).toHaveBeenCalledTimes(1);
    advance(DAEMON_UPDATE_CHECK_INTERVAL_MS);
    await updater.tick();
    expect(maintenance.check).toHaveBeenCalledTimes(2);
  });

  it('backs off after a failed attempt instead of reinstalling every few minutes', async () => {
    const { advance, maintenance, set, updater } = setup();
    await updater.tick();
    set({
      operation: {
        error: 'EACCES',
        fromInstanceId: 'self',
        id: 'x',
        kind: 'update',
        stage: 'failed',
        targetVersion: '1.1.0',
      },
    });
    advance(DAEMON_UPDATE_RETRY_INTERVAL_MS);
    await updater.tick();
    expect(maintenance.restart).toHaveBeenCalledTimes(1);
    advance(DAEMON_UPDATE_CHECK_INTERVAL_MS);
    await updater.tick();
    expect(maintenance.restart).toHaveBeenCalledTimes(2);
  });

  it('leaves a restart already in progress alone', async () => {
    const { maintenance, updater } = setup({
      latestVersion: '1.1.0',
      operation: {
        fromInstanceId: 'self',
        id: 'x',
        kind: 'update',
        stage: 'updating',
        targetVersion: '1.1.0',
      },
    });
    await updater.tick();
    expect(maintenance.restart).not.toHaveBeenCalled();
  });

  it('does nothing for an unsupported connection or after lh update --auto off', async () => {
    const unsupported = setup({ supported: false });
    await unsupported.updater.tick();
    expect(unsupported.maintenance.check).not.toHaveBeenCalled();

    vi.mocked(autoUpdate.isAutoUpdateEnabled).mockReturnValue(false);
    const disabled = setup();
    await disabled.updater.tick();
    expect(disabled.maintenance.getState).not.toHaveBeenCalled();
  });

  it('logs and survives a registry failure', async () => {
    const { maintenance, updater } = setup();
    maintenance.check.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(updater.tick()).resolves.toBeUndefined();
  });
});
