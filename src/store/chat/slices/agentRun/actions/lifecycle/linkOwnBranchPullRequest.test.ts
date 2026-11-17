import { beforeEach, describe, expect, it, vi } from 'vitest';

import { linkOwnBranchPullRequest } from './linkOwnBranchPullRequest';

const mocks = vi.hoisted(() => ({
  getLinkedPullRequest: vi.fn(),
  linkTopicPullRequest: vi.fn(),
  refreshTopicPullRequests: vi.fn(),
  resolveTopicGitTransport: vi.fn((_agentId: string, _topicDeviceId?: string) => ({
    deviceId: 'dev-1',
  })),
  topic: undefined as any,
}));

vi.mock('@/services/git', () => ({
  gitService: { getLinkedPullRequest: mocks.getLinkedPullRequest },
}));
vi.mock('@/services/work', () => ({
  workService: {
    linkTopicPullRequest: mocks.linkTopicPullRequest,
    refreshTopicPullRequests: mocks.refreshTopicPullRequests,
  },
}));
vi.mock('@/store/chat/utils/topicWorkingDirGit', () => ({
  canReadTopicGitTransport: () => true,
  resolveTopicGitTransport: mocks.resolveTopicGitTransport,
}));
vi.mock('../../../topic/selectors', () => ({
  topicSelectors: { getTopicById: () => () => mocks.topic },
}));

const get = () => ({}) as any;
const run = () => linkOwnBranchPullRequest(get, { agentId: 'a1', topicId: 't1' });

const topicOn = (git: Record<string, unknown>) => ({
  metadata: {
    workingDirectoryConfig: {
      git: { activeWorktree: '/wt', isWorktree: true, ...git },
      path: '/repo',
    },
  },
});

const lookup = (overrides: Record<string, unknown> = {}) => ({
  pullRequest: {
    headRefName: 'lobehub/feat-x',
    headRepoFullName: 'lobehub/lobehub',
    number: 7,
    state: 'OPEN',
    title: 'Opened on GitHub',
    url: 'https://github.com/lobehub/lobehub/pull/7',
    ...overrides,
  },
  pullRequestStatus: 'ok',
  remoteRepoFullName: 'lobehub/lobehub',
  upstream: { branch: 'lobehub/feat-x', remote: 'origin' },
});

const OWN = {
  branch: 'lobehub/feat-x',
  ownBranch: 'lobehub/feat-x',
  upstream: { branch: 'lobehub/feat-x', remote: 'origin' },
};

describe('linkOwnBranchPullRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linkTopicPullRequest.mockResolvedValue({ identifier: 'lobehub/lobehub#7', linked: true });
  });

  it("links the open PR of the topic's own pushed branch, vouched by its head repo", async () => {
    mocks.topic = topicOn(OWN);
    mocks.getLinkedPullRequest.mockResolvedValue(lookup());

    await run();

    // Open PRs only: an all-state list may put a newer closed PR first.
    expect(mocks.getLinkedPullRequest).toHaveBeenCalledWith({
      branch: 'lobehub/feat-x',
      deviceId: 'dev-1',
      path: '/wt',
      state: 'open',
    });
    expect(mocks.linkTopicPullRequest).toHaveBeenCalledWith({
      headRefName: 'lobehub/feat-x',
      source: 'branch',
      title: 'Opened on GitHub',
      topicId: 't1',
      url: 'https://github.com/lobehub/lobehub/pull/7',
      vouched: true,
    });
    expect(mocks.refreshTopicPullRequests).toHaveBeenCalledWith('t1');
  });

  it('leaves a same-named branch in another fork unvouched', async () => {
    mocks.topic = topicOn(OWN);
    mocks.getLinkedPullRequest.mockResolvedValue(lookup({ headRepoFullName: 'stranger/lobehub' }));

    await run();

    expect(mocks.linkTopicPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ vouched: false }),
    );
  });

  it('never looks up a branch the topic did not create, nor an unpushed one', async () => {
    mocks.topic = topicOn({ ...OWN, ownBranch: undefined });
    await run();
    mocks.topic = topicOn({ ...OWN, branch: 'main' });
    await run();
    mocks.topic = topicOn({ ...OWN, upstream: undefined });
    await run();

    expect(mocks.getLinkedPullRequest).not.toHaveBeenCalled();
  });

  it('ignores a merged or closed PR on the branch', async () => {
    mocks.topic = topicOn(OWN);
    mocks.getLinkedPullRequest.mockResolvedValue(lookup({ state: 'MERGED' }));

    await run();

    expect(mocks.linkTopicPullRequest).not.toHaveBeenCalled();
  });

  it("routes the lookup through the topic's bound device", async () => {
    mocks.topic = { metadata: { ...topicOn(OWN).metadata, boundDeviceId: 'dev-topic' } };
    mocks.getLinkedPullRequest.mockResolvedValue(lookup());

    await run();

    expect(mocks.resolveTopicGitTransport).toHaveBeenCalledWith('a1', 'dev-topic');
  });
});
