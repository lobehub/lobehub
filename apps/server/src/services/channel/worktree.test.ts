// @vitest-environment node
import { deriveWorktreePath } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';

import { createChannelWorktree } from './worktree';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    addGitWorktree: vi.fn(),
    listGitWorktrees: vi.fn(),
    queryDeviceSystemInfo: vi.fn(),
    statPath: vi.fn(),
  },
}));

const gateway = vi.mocked(deviceGateway);

const candidate = {
  branch: 'lobe-channel/0123456789ab-main',
  deviceId: 'device-1',
  deviceUserId: 'owner-1',
  memberId: 'member-1',
  sourceDirectory: '/code/lobehub',
  threadId: null,
};

const sourceCheckout = { branch: 'main', current: true, path: '/code/lobehub' };

beforeEach(() => {
  vi.resetAllMocks();
  gateway.queryDeviceSystemInfo.mockResolvedValue({ homePath: '/Users/me' } as never);
  gateway.listGitWorktrees.mockResolvedValue([sourceCheckout]);
});

describe('createChannelWorktree', () => {
  it('cuts the branch from the source directory under ~/.lobehub/worktrees', async () => {
    gateway.addGitWorktree.mockImplementation(async ({ worktreePath }) => ({
      success: true,
      worktreePath,
    }));

    const result = await createChannelWorktree(candidate, 'ws-1');

    expect(result.path).toMatch(
      /^\/Users\/me\/\.lobehub\/worktrees\/lobehub-[\da-f]{8}\/lobe-channel-0123456789ab-main$/,
    );
    expect(gateway.addGitWorktree).toHaveBeenCalledWith({
      branch: candidate.branch,
      deviceId: 'device-1',
      path: '/code/lobehub',
      userId: 'owner-1',
      workspaceId: 'ws-1',
      worktreePath: result.path,
    });
  });

  it('reuses the checkout an earlier attempt already created', async () => {
    const worktreePath = deriveWorktreePath(candidate.sourceDirectory, candidate.branch, {
      homeDir: '/Users/me',
    });
    gateway.listGitWorktrees.mockResolvedValue([
      sourceCheckout,
      { branch: candidate.branch, current: false, path: worktreePath },
    ]);

    expect(await createChannelWorktree(candidate, null)).toEqual({ path: worktreePath });
    expect(gateway.addGitWorktree).not.toHaveBeenCalled();
  });

  it('keeps a subdirectory configuration in the same subdirectory of the checkout', async () => {
    gateway.addGitWorktree.mockImplementation(async ({ worktreePath }) => ({
      success: true,
      worktreePath,
    }));
    gateway.statPath.mockResolvedValue({ isDirectory: true } as never);
    const worktreeRoot = deriveWorktreePath('/code/lobehub', candidate.branch, {
      homeDir: '/Users/me',
    });

    const result = await createChannelWorktree(
      { ...candidate, sourceDirectory: '/code/lobehub/packages/app' },
      null,
    );

    expect(result).toEqual({ path: `${worktreeRoot}/packages/app` });
    // The checkout itself is keyed by the repository, not the subdirectory.
    expect(gateway.addGitWorktree).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/code/lobehub/packages/app', worktreePath: worktreeRoot }),
    );
  });

  it('places the directory through the realpath of a checkout git spells differently', async () => {
    gateway.addGitWorktree.mockImplementation(async ({ worktreePath }) => ({
      success: true,
      worktreePath,
    }));
    // Git reports the symlinked root; the configured directory is already its realpath.
    gateway.listGitWorktrees.mockResolvedValue([{ ...sourceCheckout, path: '/link/lobehub' }]);
    gateway.statPath
      .mockResolvedValueOnce({ canonicalPath: '/code/lobehub', isDirectory: true } as never)
      .mockResolvedValue({ isDirectory: true } as never);
    const worktreeRoot = deriveWorktreePath('/link/lobehub', candidate.branch, {
      homeDir: '/Users/me',
    });

    expect(
      await createChannelWorktree(
        { ...candidate, sourceDirectory: '/code/lobehub/packages/app' },
        null,
      ),
    ).toEqual({ path: `${worktreeRoot}/packages/app` });
  });

  it('keeps waiting when the subdirectory is not part of the new checkout', async () => {
    gateway.addGitWorktree.mockImplementation(async ({ worktreePath }) => ({
      success: true,
      worktreePath,
    }));
    // An untracked or ignored directory exists in the source but not in a fresh checkout.
    gateway.statPath.mockResolvedValue(undefined);

    expect(
      await createChannelWorktree(
        { ...candidate, sourceDirectory: '/code/lobehub/packages/new-app' },
        null,
      ),
    ).toEqual({ error: 'The directory is not part of the repository checkout' });
  });

  it('keeps waiting when the directory cannot be placed inside its checkout', async () => {
    gateway.listGitWorktrees.mockResolvedValue([{ ...sourceCheckout, path: '/elsewhere' }]);

    expect(await createChannelWorktree(candidate, null)).toEqual({
      error: 'Could not locate the directory inside its repository',
    });
    expect(gateway.addGitWorktree).not.toHaveBeenCalled();
  });

  it('never asks a directory outside git to add a worktree', async () => {
    gateway.listGitWorktrees.mockResolvedValue([]);

    expect(await createChannelWorktree(candidate, null)).toEqual({
      error: 'The directory is not a git repository',
    });
    // The device creates the target's parent folder before git refuses.
    expect(gateway.addGitWorktree).not.toHaveBeenCalled();
  });

  it('reports why when git refuses the worktree', async () => {
    gateway.addGitWorktree.mockResolvedValue({
      error: "fatal: a branch named 'x' already exists",
      success: false,
    });

    expect(await createChannelWorktree(candidate, null)).toEqual({
      error: "fatal: a branch named 'x' already exists",
    });
  });

  it('does not fall back next to the repo when the device home is unknown', async () => {
    gateway.queryDeviceSystemInfo.mockResolvedValue(undefined);

    expect(await createChannelWorktree(candidate, null)).toEqual({
      error: 'The device did not report its home directory',
    });
    expect(gateway.addGitWorktree).not.toHaveBeenCalled();
  });
});
