/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarPullRequests } from '../useSidebarPullRequests';

const mocks = vi.hoisted(() => ({
  linked: {
    primary: undefined as any,
    probes: [] as any[],
    views: [] as any[],
  },
  dismiss: vi.fn(async () => ({ updated: true })),
  link: vi.fn(async () => ({ identifier: 'a/b#4', linked: true })),
  refresh: vi.fn(),
}));

vi.mock('@/features/TopicPullRequests/useTopicPullRequests', () => ({
  useTopicPullRequests: () => mocks.linked,
}));
vi.mock('@/services/work', () => ({
  workService: {
    linkTopicPullRequest: mocks.link,
    refreshTopicPullRequests: mocks.refresh,
    setTopicPullRequestDismissed: mocks.dismiss,
  },
}));

const view = (number: number, extra: Record<string, unknown> = {}) => ({
  confirmed: true,
  identifier: `a/b#${number}`,
  isDraft: false,
  localDetail: true,
  source: 'created',
  vouched: true,
  number,
  repoFullName: 'a/b',
  state: 'open',
  title: `PR ${number}`,
  url: `https://github.com/a/b/pull/${number}`,
  ...extra,
});

const PARAMS = {
  available: true,
  topicId: 't1',
  workingDirectory: '/repo',
};

describe('useSidebarPullRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.linked = { primary: undefined, probes: [], views: [] };
  });

  it('lists every linked PR and opens the picked one in the tab', () => {
    const views = [view(3), view(2), view(9, { localDetail: false })];
    mocks.linked = { primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    expect(result.current.pullRequests).toHaveLength(3);
    expect(result.current.pullRequest?.number).toBe(3);

    let opened: boolean | undefined;
    act(() => {
      opened = result.current.pickPullRequest?.(views[1] as any);
    });
    expect(opened).toBe(true);
    expect(result.current.pullRequest?.number).toBe(2);
    // A PR in another repository cannot open in the pane; the caller opens GitHub.
    expect(result.current.pickPullRequest?.(views[2] as any)).toBe(false);
  });

  it('locks mutations until the PR is confirmed', () => {
    const views = [view(3, { confirmed: false })];
    mocks.linked = { primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    expect(result.current.confirmed).toBe(false);
    result.current.onRetryConfirm?.();
    expect(mocks.refresh).toHaveBeenCalledWith('t1');
  });

  it('keeps a confirmed PR locked when the app cannot vouch for it', () => {
    const views = [view(3, { vouched: false })];
    mocks.linked = { primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    expect(result.current.confirmed).toBe(false);
  });

  it('removes and links PRs on the topic, then refreshes its list', async () => {
    const views = [view(3)];
    mocks.linked = { primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    await act(async () => {
      await result.current.dismissPullRequest?.(views[0] as any);
    });
    expect(mocks.dismiss).toHaveBeenCalledWith({
      dismissed: true,
      identifier: 'a/b#3',
      topicId: 't1',
    });

    let identifier: string | undefined;
    await act(async () => {
      identifier = await result.current.linkPullRequest?.('https://github.com/a/b/pull/4');
    });
    expect(mocks.link).toHaveBeenCalledWith({
      source: 'manual',
      topicId: 't1',
      url: 'https://github.com/a/b/pull/4',
    });
    expect(identifier).toBe('a/b#4');
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('rejects a link or removal the server did not save', async () => {
    const views = [view(3)];
    mocks.linked = { primary: views[0], probes: [], views };
    mocks.link.mockResolvedValueOnce({ identifier: 'a/b#4', linked: false });
    mocks.dismiss.mockResolvedValueOnce({ updated: false });
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    await expect(
      result.current.linkPullRequest?.('https://github.com/a/b/pull/4'),
    ).rejects.toThrow();
    await expect(result.current.dismissPullRequest?.(views[0] as any)).rejects.toThrow();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('offers no link or removal before the conversation has a topic', () => {
    const views = [view(3)];
    mocks.linked = { primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests({ ...PARAMS, topicId: null }));

    expect(result.current.linkPullRequest).toBeUndefined();
    expect(result.current.dismissPullRequest).toBeUndefined();
  });
});
