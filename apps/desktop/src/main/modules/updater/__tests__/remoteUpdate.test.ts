import type { UpdaterState } from '@lobechat/electron-client-ipc';
import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteAppUpdateDeps,
  REMOTE_INSTALL_DELAY_MS,
  type RemoteUpdaterTarget,
  toAppUpdateState,
} from '../remoteUpdate';

const updateInfo = { kind: 'app' as const, releaseDate: '2026-09-25', version: '2.2.0' };

const makeUpdater = (initial: UpdaterState) => {
  let state = initial;
  const updater: RemoteUpdaterTarget = {
    checkForUpdatesOnRequest: vi.fn(() => {
      state = { stage: 'checking' };
    }),
    getUpdaterState: () => state,
    installNow: vi.fn(),
  };
  return updater;
};

const setup = (initial: UpdaterState, enabled = true) => {
  const updater = makeUpdater(initial);
  const schedule = vi.fn();
  const deps = createRemoteAppUpdateDeps({
    currentVersion: '2.1.0',
    enabled,
    getUpdater: async () => updater,
    schedule,
  });
  return { deps, schedule, updater };
};

describe('toAppUpdateState', () => {
  it('reports progress and target while downloading', () => {
    expect(
      toAppUpdateState(
        {
          progress: { bytesPerSecond: 1, percent: 42.6, total: 100, transferred: 42 },
          stage: 'downloading',
          updateInfo,
        },
        '2.1.0',
      ),
    ).toEqual({
      currentVersion: '2.1.0',
      progress: 43,
      stage: 'downloading',
      targetVersion: '2.2.0',
    });
  });

  it('drops the stale update info once the updater has settled', () => {
    expect(toAppUpdateState({ stage: 'latest', updateInfo }, '2.1.0')).toEqual({
      currentVersion: '2.1.0',
      stage: 'latest',
    });
  });

  it('carries the error message on failure', () => {
    expect(toAppUpdateState({ errorMessage: 'net down', stage: 'error' }, '2.1.0')).toEqual({
      currentVersion: '2.1.0',
      errorMessage: 'net down',
      stage: 'error',
    });
  });
});

describe('createRemoteAppUpdateDeps', () => {
  it('reports unsupported on a build that cannot update itself', async () => {
    const { deps, updater } = setup({ stage: 'idle' }, false);

    await expect(deps.getAppUpdateState()).resolves.toEqual({
      currentVersion: '2.1.0',
      stage: 'unsupported',
    });
    await expect(deps.checkAppUpdate()).resolves.toMatchObject({ stage: 'unsupported' });
    await expect(deps.installAppUpdate()).rejects.toThrow('cannot install updates');
    expect(updater.checkForUpdatesOnRequest).not.toHaveBeenCalled();
  });

  it('starts a check and returns the checking state', async () => {
    const { deps, updater } = setup({ stage: 'idle' });

    await expect(deps.checkAppUpdate()).resolves.toEqual({
      currentVersion: '2.1.0',
      stage: 'checking',
    });
    expect(updater.checkForUpdatesOnRequest).toHaveBeenCalledOnce();
  });

  it('does not check again when an update is already downloaded', async () => {
    const { deps, updater } = setup({ stage: 'downloaded', updateInfo });

    await expect(deps.checkAppUpdate()).resolves.toMatchObject({
      stage: 'downloaded',
      targetVersion: '2.2.0',
    });
    expect(updater.checkForUpdatesOnRequest).not.toHaveBeenCalled();
  });

  it('answers before restarting into a downloaded update', async () => {
    const { deps, schedule, updater } = setup({ stage: 'downloaded', updateInfo });

    await expect(deps.installAppUpdate()).resolves.toEqual({ targetVersion: '2.2.0' });
    expect(updater.installNow).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), REMOTE_INSTALL_DELAY_MS);

    schedule.mock.calls[0][0]();
    expect(updater.installNow).toHaveBeenCalledOnce();
  });

  it('refuses to install while nothing is downloaded', async () => {
    const { deps, schedule } = setup({ stage: 'downloading', updateInfo });

    await expect(deps.installAppUpdate()).rejects.toThrow('No downloaded update to install');
    expect(schedule).not.toHaveBeenCalled();
  });
});
