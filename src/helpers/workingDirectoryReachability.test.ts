import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveReachableWorkingDirectory } from './workingDirectoryReachability';

const SOURCE = '/repo/lobehub';
const WORKTREE = '/repo/lobehub-worktree-feat';

const testState = vi.hoisted(() => ({
  devices: [] as Array<{ deviceId: string; online?: boolean }>,
  getGitBranch: vi.fn(),
}));

vi.mock('@/services/git', () => ({
  gitService: { getGitBranch: testState.getGitBranch },
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceById: (deviceId?: string) => (s: { devices: Array<{ deviceId: string }> }) =>
      s.devices.find((device) => device.deviceId === deviceId),
  },
  getDeviceStoreState: () => ({ devices: testState.devices }),
}));

const worktreeConfig = {
  git: { activeWorktree: WORKTREE, isWorktree: true },
  path: SOURCE,
};

describe('resolveReachableWorkingDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.devices = [];
    testState.getGitBranch.mockResolvedValue({ branch: 'feat/x' });
  });

  it('keeps a worktree that is still on disk', async () => {
    await expect(resolveReachableWorkingDirectory({ recorded: worktreeConfig })).resolves.toEqual({
      fellBackToSource: false,
      path: WORKTREE,
    });
    expect(testState.getGitBranch).toHaveBeenCalledWith({ deviceId: undefined, path: WORKTREE });
  });

  // The spawn layer refuses to auto-create a missing directory, so a deleted
  // worktree would kill the run instead of letting it continue in the repo.
  it('falls back to the source repo when the recorded worktree is gone', async () => {
    testState.getGitBranch.mockResolvedValue({});

    await expect(resolveReachableWorkingDirectory({ recorded: worktreeConfig })).resolves.toEqual({
      fellBackToSource: true,
      path: SOURCE,
    });
  });

  it('reads nothing when no worktree override is recorded', async () => {
    await expect(resolveReachableWorkingDirectory({ recorded: { path: SOURCE } })).resolves.toEqual(
      { fellBackToSource: false, path: SOURCE },
    );
    await expect(resolveReachableWorkingDirectory({ recorded: undefined })).resolves.toEqual({
      fellBackToSource: false,
      path: undefined,
    });
    expect(testState.getGitBranch).not.toHaveBeenCalled();
  });

  it('keeps the recorded path when the read fails', async () => {
    testState.getGitBranch.mockRejectedValue(new Error('transport down'));

    await expect(resolveReachableWorkingDirectory({ recorded: worktreeConfig })).resolves.toEqual({
      fellBackToSource: false,
      path: WORKTREE,
    });
  });

  // An offline device answers a directory read the same way a deleted directory
  // does, so it must never be mistaken for a missing checkout.
  it('keeps the recorded path for an offline device', async () => {
    testState.getGitBranch.mockResolvedValue({});

    await expect(
      resolveReachableWorkingDirectory({ deviceId: 'remote-1', recorded: worktreeConfig }),
    ).resolves.toEqual({ fellBackToSource: false, path: WORKTREE });
    expect(testState.getGitBranch).not.toHaveBeenCalled();
  });

  it('reads a reachable remote device through its own device id', async () => {
    testState.devices = [{ deviceId: 'remote-1', online: true }];
    testState.getGitBranch.mockResolvedValue({});

    await expect(
      resolveReachableWorkingDirectory({ deviceId: 'remote-1', recorded: worktreeConfig }),
    ).resolves.toEqual({ fellBackToSource: true, path: SOURCE });
    expect(testState.getGitBranch).toHaveBeenCalledWith({ deviceId: 'remote-1', path: WORKTREE });
  });
});
