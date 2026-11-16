import { DEVICE_GIT_OUTDATED } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceGitOutdatedError, gitService, isDeviceGitOutdated } from './git';

const mocks = vi.hoisted(() => ({
  addWorktreeIpc: vi.fn(),
  addWorktreeRpc: vi.fn(),
  aheadBehindIpc: vi.fn(),
  aheadBehindRpc: vi.fn(),
  checkoutIpc: vi.fn(),
  checkoutRpc: vi.fn(),
  pullRpc: vi.fn(),
  pushIpc: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    device: {
      addGitWorktree: { mutate: mocks.addWorktreeRpc },
      checkoutGitBranch: { mutate: mocks.checkoutRpc },
      gitAheadBehind: { query: mocks.aheadBehindRpc },
      pullGitBranch: { mutate: mocks.pullRpc },
    },
  },
}));

vi.mock('@/services/electron/git', () => ({
  electronGitService: {
    addGitWorktree: mocks.addWorktreeIpc,
    checkoutGitBranch: mocks.checkoutIpc,
    getGitAheadBehind: mocks.aheadBehindIpc,
    pushGitBranch: mocks.pushIpc,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Device RPCs have no capability negotiation: an older device ignores a new
 * parameter and acts on HEAD. The service must turn such an answer into a
 * failure instead of a silent downgrade.
 */
describe('gitService device echo checks', () => {
  it('accepts a checkout whose start point the device echoed', async () => {
    mocks.checkoutRpc.mockResolvedValue({ startPoint: 'feat', success: true });
    const result = await gitService.checkoutGitBranch({
      branch: 'lobehub/x',
      create: true,
      deviceId: 'd',
      path: '/repo',
      startPoint: 'feat',
    });

    expect(result).toEqual({ startPoint: 'feat', success: true });
    expect(mocks.checkoutRpc).toHaveBeenCalledWith({
      branch: 'lobehub/x',
      create: true,
      deviceId: 'd',
      path: '/repo',
      startPoint: 'feat',
    });
  });

  it('rejects a checkout from a device that ignored the start point', async () => {
    mocks.checkoutIpc.mockResolvedValue({ success: true });
    const result = await gitService.checkoutGitBranch({
      branch: 'lobehub/x',
      create: true,
      path: '/repo',
      startPoint: 'feat',
    });

    expect(result).toMatchObject({ reason: DEVICE_GIT_OUTDATED, success: false });
    expect(isDeviceGitOutdated(result)).toBe(true);
  });

  it('leaves a plain checkout alone', async () => {
    mocks.checkoutIpc.mockResolvedValue({ success: true });
    expect(await gitService.checkoutGitBranch({ branch: 'main', path: '/repo' })).toEqual({
      success: true,
    });
    expect(mocks.checkoutIpc).toHaveBeenCalledWith({
      branch: 'main',
      create: undefined,
      path: '/repo',
    });
  });

  it('passes a git failure through untouched', async () => {
    mocks.checkoutIpc.mockResolvedValue({ error: 'conflict', success: false });
    expect(
      await gitService.checkoutGitBranch({
        branch: 'x',
        create: true,
        path: '/repo',
        startPoint: 'feat',
      }),
    ).toEqual({ error: 'conflict', success: false });
  });

  it('rejects a worktree whose start point does not match', async () => {
    mocks.addWorktreeRpc.mockResolvedValue({
      startPoint: 'main',
      success: true,
      worktreePath: '/w',
    });
    const result = await gitService.addGitWorktree({
      branch: 'lobehub/x',
      deviceId: 'd',
      path: '/repo',
      startPoint: 'feat',
      stripBranchPrefix: true,
      worktreePath: '',
    });

    expect(result).toMatchObject({ reason: DEVICE_GIT_OUTDATED, success: false });
    expect(mocks.addWorktreeRpc).toHaveBeenCalledWith(
      expect.objectContaining({ startPoint: 'feat', stripBranchPrefix: true }),
    );
  });

  it('accepts a worktree with a matching echo on the local route', async () => {
    mocks.addWorktreeIpc.mockResolvedValue({
      startPoint: 'feat',
      success: true,
      worktreePath: '/w',
    });
    const result = await gitService.addGitWorktree({
      branch: 'lobehub/x',
      path: '/repo',
      startPoint: 'feat',
      worktreePath: '/w',
    });

    expect(result).toMatchObject({ success: true, worktreePath: '/w' });
    expect(mocks.addWorktreeIpc).toHaveBeenCalledWith({
      branch: 'lobehub/x',
      path: '/repo',
      startPoint: 'feat',
      worktreePath: '/w',
    });
  });

  it('rejects a named-branch pull / push that came back without the branch', async () => {
    mocks.pullRpc.mockResolvedValue({ noop: true, success: true });
    mocks.pushIpc.mockResolvedValue({ noop: false, success: true });

    expect(
      await gitService.pullGitBranch({ branch: 'feat', deviceId: 'd', path: '/repo' }),
    ).toMatchObject({ reason: DEVICE_GIT_OUTDATED, success: false });
    expect(await gitService.pushGitBranch({ branch: 'feat', path: '/repo' })).toMatchObject({
      reason: DEVICE_GIT_OUTDATED,
      success: false,
    });
  });

  it('reads named-branch counts only when the device echoes the branch', async () => {
    mocks.aheadBehindRpc.mockResolvedValueOnce({
      ahead: 1,
      behind: 0,
      branch: 'feat',
      hasUpstream: true,
    });
    await expect(
      gitService.getGitAheadBehind({ branch: 'feat', deviceId: 'd', path: '/repo' }),
    ).resolves.toMatchObject({ ahead: 1, branch: 'feat' });

    mocks.aheadBehindIpc.mockResolvedValueOnce({ ahead: 3, behind: 0, hasUpstream: true });
    await expect(
      gitService.getGitAheadBehind({ branch: 'feat', path: '/repo' }),
    ).rejects.toBeInstanceOf(DeviceGitOutdatedError);
    expect(mocks.aheadBehindIpc).toHaveBeenCalledWith('/repo', 'feat');
  });

  it('keeps an unreachable device as "no answer", not as outdated', async () => {
    mocks.aheadBehindRpc.mockResolvedValue(null);
    await expect(
      gitService.getGitAheadBehind({ branch: 'feat', deviceId: 'd', path: '/repo' }),
    ).resolves.toBeUndefined();
  });
});
