import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linkPushedPullRequests } from '../pushedPullRequests';

const mocks = vi.hoisted(() => ({
  getLinkedPullRequest: vi.fn(),
  linkPushedPullRequests: vi.fn(),
  refreshTopicPullRequests: vi.fn(),
}));

vi.mock('@/services/git', () => ({
  gitService: { getLinkedPullRequest: mocks.getLinkedPullRequest },
}));
vi.mock('@/services/work', () => ({
  workService: {
    linkPushedPullRequests: mocks.linkPushedPullRequests,
    refreshTopicPullRequests: mocks.refreshTopicPullRequests,
  },
}));

const PARAMS = { branch: 'local', path: '/repo', toolCallId: 'call-1', topicId: 't1' };

const lookup = (state = 'OPEN') => ({
  pullRequest: {
    isDraft: false,
    number: 12,
    state,
    title: 'Feat',
    url: 'https://github.com/lobehub/lobehub/pull/12',
  },
  pullRequestStatus: 'ok',
  upstream: { branch: 'feat/x', remote: 'origin' },
});

describe('linkPushedPullRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("offers the device's open PR for the remote branch and refreshes the list", async () => {
    mocks.getLinkedPullRequest.mockResolvedValue(lookup());
    mocks.linkPushedPullRequests.mockResolvedValue({
      linked: ['lobehub/lobehub#12'],
      status: 'linked',
    });

    expect(await linkPushedPullRequests(PARAMS)).toEqual(['lobehub/lobehub#12']);
    expect(mocks.getLinkedPullRequest).toHaveBeenCalledWith({
      branch: 'local',
      deviceId: undefined,
      path: '/repo',
    });
    expect(mocks.linkPushedPullRequests).toHaveBeenCalledWith({
      pullRequests: [
        {
          headRefName: 'feat/x',
          isDraft: false,
          number: 12,
          state: 'OPEN',
          title: 'Feat',
          url: 'https://github.com/lobehub/lobehub/pull/12',
        },
      ],
      toolCallId: 'call-1',
      topicId: 't1',
    });
    expect(mocks.refreshTopicPullRequests).toHaveBeenCalledWith('t1');
  });

  it('never offers a merged or closed PR that shares the branch', async () => {
    mocks.getLinkedPullRequest.mockResolvedValue(lookup('MERGED'));
    mocks.linkPushedPullRequests.mockResolvedValue({ linked: [], status: 'linked' });

    await linkPushedPullRequests(PARAMS);

    expect(mocks.linkPushedPullRequests.mock.calls[0][0].pullRequests).toEqual([]);
    expect(mocks.refreshTopicPullRequests).not.toHaveBeenCalled();
  });

  it('still asks the server (GitHub App) when the device cannot answer', async () => {
    mocks.getLinkedPullRequest.mockResolvedValue({
      pullRequest: null,
      pullRequestStatus: 'gh-missing',
    });
    mocks.linkPushedPullRequests.mockResolvedValue({ linked: ['a/b#1'], status: 'linked' });

    expect(await linkPushedPullRequests(PARAMS)).toEqual(['a/b#1']);
    expect(mocks.linkPushedPullRequests.mock.calls[0][0].pullRequests).toEqual([]);
  });

  it('retries while the push is not persisted yet, then gives up', async () => {
    mocks.getLinkedPullRequest.mockResolvedValue(lookup());
    mocks.linkPushedPullRequests.mockResolvedValue({ status: 'pending' });

    const done = linkPushedPullRequests(PARAMS);
    await vi.runAllTimersAsync();

    expect(await done).toEqual([]);
    expect(mocks.linkPushedPullRequests).toHaveBeenCalledTimes(4);
  });

  it('stops once the server skips the call', async () => {
    mocks.getLinkedPullRequest.mockResolvedValue(lookup());
    mocks.linkPushedPullRequests.mockResolvedValue({ status: 'skipped' });

    expect(await linkPushedPullRequests(PARAMS)).toEqual([]);
    expect(mocks.linkPushedPullRequests).toHaveBeenCalledTimes(1);
  });

  it('swallows failures', async () => {
    mocks.getLinkedPullRequest.mockRejectedValue(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await linkPushedPullRequests(PARAMS)).toEqual([]);
  });
});
