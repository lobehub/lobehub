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

vi.mock('@/store/electron', () => ({
  getElectronStoreState: () => ({ gatewayDeviceInfo: undefined }),
}));

vi.mock('@/helpers/agentWorkingDirectory', () => ({
  resolveTargetDeviceId: () => undefined,
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
