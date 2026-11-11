// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceGateway } from '@/server/services/deviceGateway';

import { createChannelWorktree } from './worktree';

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    addGitWorktree: vi.fn(),
    listGitWorktrees: vi.fn(),
    queryDeviceSystemInfo: vi.fn(),
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

beforeEach(() => {
  vi.resetAllMocks();
  gateway.queryDeviceSystemInfo.mockResolvedValue({ homePath: '/Users/me' } as never);
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
    gateway.addGitWorktree.mockResolvedValue({ error: 'already exists', success: false });
    gateway.listGitWorktrees.mockImplementation(async () => [
      {
        branch: candidate.branch,
        current: false,
        path: (gateway.addGitWorktree.mock.calls[0][0] as { worktreePath: string }).worktreePath,
      },
    ]);

    const result = await createChannelWorktree(candidate, null);

    expect(result.path).toContain('/Users/me/.lobehub/worktrees/');
  });

  it('reports why when the directory cannot host a worktree', async () => {
    gateway.addGitWorktree.mockResolvedValue({
      error: 'fatal: not a git repository',
      success: false,
    });
    gateway.listGitWorktrees.mockResolvedValue([]);

    expect(await createChannelWorktree(candidate, null)).toEqual({
      error: 'fatal: not a git repository',
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
