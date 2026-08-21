import type { WorkingDirConfig } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceService } from '@/services/device';

import { clearWorktreeProbeCache, pruneMissingWorktree } from './pruneMissingWorktree';

vi.mock('@/services/device', () => ({
  deviceService: { statPath: vi.fn() },
}));

const statPath = vi.mocked(deviceService.statPath);

const DEVICE_ID = 'device-1';
const SOURCE = '/repo/lobehub';
const WORKTREE = '/repo/lobehub-wt-project';

const config: WorkingDirConfig = {
  git: { activeWorktree: WORKTREE },
  path: SOURCE,
  repoType: 'github',
};

const stat = (exists: boolean) => ({ exists, isDirectory: exists });

describe('pruneMissingWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWorktreeProbeCache();
  });

  it('should drop a worktree override whose directory is gone', async () => {
    statPath.mockImplementation(async (_deviceId, path) => stat(path !== WORKTREE) as any);

    const result = await pruneMissingWorktree({ config, deviceId: DEVICE_ID });

    expect(result).toEqual({ git: { isWorktree: false }, path: SOURCE, repoType: 'github' });
  });

  it('should drop the branch snapshot taken inside the deleted worktree', async () => {
    statPath.mockImplementation(async (_deviceId, path) => stat(path !== WORKTREE) as any);

    const result = await pruneMissingWorktree({
      config: {
        git: {
          activeWorktree: WORKTREE,
          branch: 'feat/x',
          github: { pullRequestStatus: 'ok' },
          isWorktree: true,
          upstream: { branch: 'feat/x', remote: 'origin' },
        },
        path: SOURCE,
      },
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ git: { isWorktree: false }, path: SOURCE });
  });

  it('should keep a worktree that still exists', async () => {
    statPath.mockResolvedValue(stat(true) as any);

    const result = await pruneMissingWorktree({ config, deviceId: DEVICE_ID });

    expect(result).toBe(config);
  });

  // An offline device answers `null` for every path — indistinguishable from a
  // deleted directory if we treated it as evidence, which would strip a live
  // worktree off the topic the moment the laptop sleeps.
  it('should keep the override when the device cannot be reached', async () => {
    statPath.mockResolvedValue(null);

    const result = await pruneMissingWorktree({ config, deviceId: DEVICE_ID });

    expect(result).toBe(config);
  });

  it('should keep the override when the source repo is gone too', async () => {
    statPath.mockResolvedValue(stat(false) as any);

    const result = await pruneMissingWorktree({ config, deviceId: DEVICE_ID });

    expect(result).toBe(config);
  });

  it('should not probe when no worktree is recorded', async () => {
    const plain: WorkingDirConfig = { path: SOURCE };

    const result = await pruneMissingWorktree({ config: plain, deviceId: DEVICE_ID });

    expect(result).toBe(plain);
    expect(statPath).not.toHaveBeenCalled();
  });

  // The probe runs on the send path; a client whose device RPC is unavailable
  // (throwing, not answering `null`) must not take the message down with it.
  it('should keep the override when the probe throws', async () => {
    statPath.mockImplementation(() => {
      throw new TypeError('device client unavailable');
    });

    const result = await pruneMissingWorktree({ config, deviceId: DEVICE_ID });

    expect(result).toBe(config);
  });

  it('should not probe without a device to ask', async () => {
    const result = await pruneMissingWorktree({ config });

    expect(result).toBe(config);
    expect(statPath).not.toHaveBeenCalled();
  });

  // The probe rides on the send path, so a worktree-bound conversation must not
  // pay a gateway round-trip per message.
  it('should reuse a cached probe result across calls', async () => {
    statPath.mockResolvedValue(stat(true) as any);

    await pruneMissingWorktree({ config, deviceId: DEVICE_ID });
    await pruneMissingWorktree({ config, deviceId: DEVICE_ID });

    expect(statPath).toHaveBeenCalledTimes(1);
  });
});
