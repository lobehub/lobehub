import type { ToolAfterCallContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { antigravityExecutor } from '../heteroCli';

const mocks = vi.hoisted(() => ({
  revalidateGitStatus: vi.fn(),
  updateTopicMetadata: vi.fn(),
}));

vi.mock('@/store/chat/store', () => ({
  getChatStoreState: () => ({ updateTopicMetadata: mocks.updateTopicMetadata }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    getTopicById: () => () => ({
      metadata: {
        boundDeviceId: 'remote-device',
        workingDirectoryConfig: { git: { branch: 'canary' }, path: '/repo' },
      },
    }),
  },
}));

vi.mock('@/store/device/gitStatus/store', () => ({
  getGitStatusStoreState: () => ({ revalidateGitStatus: mocks.revalidateGitStatus }),
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: { deviceId: 'local-device' } }),
}));

vi.mock('@/services/git', () => ({ gitService: { listGitWorktrees: vi.fn() } }));

const call = (overrides: Partial<ToolAfterCallContext> = {}): ToolAfterCallContext => ({
  apiName: 'run_command',
  identifier: 'antigravity',
  params: { CommandLine: 'git worktree add -b fix/agy ../agy-worktree' },
  result: { content: '', success: true },
  topicId: 'run-topic',
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('Antigravity Git completion effects', () => {
  it('records the native CommandLine worktree on the run topic', async () => {
    await antigravityExecutor.onAfterCall(call());

    expect(mocks.updateTopicMetadata).toHaveBeenCalledWith('run-topic', {
      workingDirectoryConfig: {
        git: { activeWorktree: '/agy-worktree', branch: 'fix/agy', isWorktree: true },
        path: '/repo',
      },
    });
  });

  it('refreshes the remote topic branch after a successful native git switch', async () => {
    await antigravityExecutor.onAfterCall(call({ params: { CommandLine: 'git switch fix/agy' } }));

    expect(mocks.updateTopicMetadata).toHaveBeenCalledWith('run-topic', {
      workingDirectoryConfig: { git: { branch: 'fix/agy' }, path: '/repo' },
    });
    expect(mocks.revalidateGitStatus).toHaveBeenCalledWith('remote-device', '/repo', ['branch']);
  });

  it.each([
    { result: { content: 'command failed', success: false } },
    { topicId: undefined },
    { apiName: 'write_to_file' },
    { params: { CommandLine: 42 } },
    { params: { content: 'git worktree add -b fix/agy ../agy-worktree' } },
  ])(
    'does not mutate topic metadata for an unrelated or unsuccessful call: %j',
    async (override) => {
      await antigravityExecutor.onAfterCall(call(override));

      expect(mocks.updateTopicMetadata).not.toHaveBeenCalled();
      expect(mocks.revalidateGitStatus).not.toHaveBeenCalled();
    },
  );
});
