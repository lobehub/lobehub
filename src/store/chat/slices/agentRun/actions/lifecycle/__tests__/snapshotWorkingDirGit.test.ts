import type * as LobechatConstModule from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotTopicWorkingDirGit } from '../snapshotWorkingDirGit';

const mockConstEnv = vi.hoisted(() => ({ isDesktop: true }));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return mockConstEnv.isDesktop;
    },
  };
});

const gitMocks = vi.hoisted(() => ({
  getGitBranch: vi.fn(),
  getLinkedPullRequest: vi.fn(),
}));

vi.mock('@/services/git', () => ({
  gitService: {
    getGitBranch: gitMocks.getGitBranch,
    getLinkedPullRequest: gitMocks.getLinkedPullRequest,
  },
}));

vi.mock('@/store/agent', () => ({
  getAgentStoreState: () => ({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgencyConfigById: () => () => undefined,
  },
}));

const env = vi.hoisted(() => ({
  currentDeviceId: undefined as string | undefined,
  targetDeviceId: undefined as string | undefined,
}));

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({
    gatewayDeviceInfo: env.currentDeviceId ? { deviceId: env.currentDeviceId } : undefined,
  }),
}));

vi.mock('@/helpers/agentWorkingDirectory', () => ({
  resolveTargetDeviceId: () => env.targetDeviceId,
}));

const deviceMocks = vi.hoisted(() => ({
  workingDirs: [] as { path: string; repoType?: string }[],
}));

vi.mock('@/store/device', () => ({
  deviceSelectors: {
    getDeviceWorkingDirs: () => () => deviceMocks.workingDirs,
  },
  getDeviceStoreState: () => ({}),
}));

const electronGitMocks = vi.hoisted(() => ({ detectRepoType: vi.fn() }));

vi.mock('@/services/electron/git', () => ({
  electronGitService: { detectRepoType: electronGitMocks.detectRepoType },
}));

const topicMocks = vi.hoisted(() => ({ getTopicById: vi.fn() }));

vi.mock('../../../../topic/selectors', () => ({
  topicSelectors: {
    getTopicById: (id: string) => (state: unknown) => topicMocks.getTopicById(id, state),
  },
}));

const PR = {
  ciStatus: 'pending' as const,
  number: 123,
  state: 'OPEN',
  title: 'Improve worktree handling',
  url: 'https://github.com/lobehub/lobehub/pull/123',
};

const githubTopic = {
  metadata: {
    workingDirectory: '/repo',
    workingDirectoryConfig: {
      git: { branch: 'old-branch' },
      path: '/repo',
      repoType: 'github',
    },
  },
};

const makeGet = () => {
  const updateTopicMetadata = vi.fn().mockResolvedValue(undefined);
  const get = () => ({ updateTopicMetadata }) as any;
  return { get, updateTopicMetadata };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConstEnv.isDesktop = true;
  env.currentDeviceId = undefined;
  env.targetDeviceId = undefined;
  deviceMocks.workingDirs = [];
  electronGitMocks.detectRepoType.mockResolvedValue(undefined);
  gitMocks.getGitBranch.mockResolvedValue({ branch: 'fix/remote-review', detached: false });
  gitMocks.getLinkedPullRequest.mockResolvedValue({ pullRequest: PR, pullRequestStatus: 'ok' });
});

describe('snapshotTopicWorkingDirGit', () => {
  it('snapshots the live branch + linked PR onto the topic config', async () => {
    topicMocks.getTopicById.mockReturnValue(githubTopic);
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      workingDirectoryConfig: {
        git: {
          branch: 'fix/remote-review',
          github: { pullRequest: PR, pullRequestStatus: 'ok' },
          isWorktree: false,
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('snapshots a legacy workingDirectory-only topic (repoType from device workingDirs)', async () => {
    // Older topics persist only `workingDirectory` with no `workingDirectoryConfig`;
    // the repo type must come from the device, not the (absent) stored config.
    topicMocks.getTopicById.mockReturnValue({ metadata: { workingDirectory: '/repo' } });
    deviceMocks.workingDirs = [{ path: '/repo', repoType: 'github' }];
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(updateTopicMetadata).toHaveBeenCalledWith('topic-1', {
      workingDirectoryConfig: {
        git: {
          branch: 'fix/remote-review',
          github: { pullRequest: PR, pullRequestStatus: 'ok' },
          isWorktree: false,
        },
        path: '/repo',
        repoType: 'github',
      },
    });
  });

  it('resolves repoType via a local filesystem probe when the device cache misses', async () => {
    env.currentDeviceId = 'dev-1';
    env.targetDeviceId = 'dev-1';
    deviceMocks.workingDirs = [];
    electronGitMocks.detectRepoType.mockResolvedValue('github');
    topicMocks.getTopicById.mockReturnValue({ metadata: { workingDirectory: '/repo' } });
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(electronGitMocks.detectRepoType).toHaveBeenCalledWith('/repo');
    expect(updateTopicMetadata).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({
        workingDirectoryConfig: expect.objectContaining({ repoType: 'github' }),
      }),
    );
  });

  it('does nothing for a legacy topic whose device repoType is non-github', async () => {
    topicMocks.getTopicById.mockReturnValue({ metadata: { workingDirectory: '/repo' } });
    deviceMocks.workingDirs = [{ path: '/repo', repoType: 'git' }];
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(gitMocks.getGitBranch).not.toHaveBeenCalled();
    expect(updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('does nothing for a non-github repo', async () => {
    topicMocks.getTopicById.mockReturnValue({
      metadata: { workingDirectoryConfig: { path: '/repo', repoType: 'git' } },
    });
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(gitMocks.getGitBranch).not.toHaveBeenCalled();
    expect(updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('leaves the prior snapshot on a detached HEAD (no branch to query)', async () => {
    topicMocks.getTopicById.mockReturnValue(githubTopic);
    gitMocks.getGitBranch.mockResolvedValue({ branch: 'abc1234', detached: true });
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(gitMocks.getLinkedPullRequest).not.toHaveBeenCalled();
    expect(updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('skips the write when the resolved config is unchanged (idempotent)', async () => {
    topicMocks.getTopicById.mockReturnValue({
      metadata: {
        workingDirectoryConfig: {
          git: {
            branch: 'fix/remote-review',
            github: { pullRequest: PR, pullRequestStatus: 'ok' },
            isWorktree: false,
          },
          path: '/repo',
          repoType: 'github',
        },
      },
    });
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(updateTopicMetadata).not.toHaveBeenCalled();
  });

  it('bails on web (no deviceId, not desktop) without probing git', async () => {
    mockConstEnv.isDesktop = false;
    topicMocks.getTopicById.mockReturnValue(githubTopic);
    const { get, updateTopicMetadata } = makeGet();

    await snapshotTopicWorkingDirGit(get, { agentId: 'agent-1', topicId: 'topic-1' });

    expect(gitMocks.getGitBranch).not.toHaveBeenCalled();
    expect(updateTopicMetadata).not.toHaveBeenCalled();
  });
});
