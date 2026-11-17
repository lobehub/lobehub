/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarPullRequests } from '../useSidebarPullRequests';

const mocks = vi.hoisted(() => ({
  betterCoding: true,
  legacy: vi.fn(),
  linked: {
    enabled: true,
    primary: undefined as any,
    probes: [] as any[],
    views: [] as any[],
  },
  dismiss: vi.fn(async () => ({ updated: true })),
  link: vi.fn(async () => ({ identifier: 'a/b#4', linked: true })),
  refresh: vi.fn(),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableBetterCodingExperience: () => mocks.betterCoding },
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
vi.mock('../useLinkedPullRequest', () => ({
  useLinkedPullRequest: (params: unknown) => {
    mocks.legacy(params);
    return { confirmed: true, pullRequest: { number: 1 }, refresh: vi.fn() };
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
  gitPath: '/repo',
  isGithub: true,
  topicId: 't1',
  workingDirectory: '/repo',
};

describe('useSidebarPullRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.betterCoding = true;
    mocks.linked = { enabled: true, primary: undefined, probes: [], views: [] };
  });

  it('keeps the branch PR path untouched without the lab', () => {
    mocks.betterCoding = false;
    mocks.linked = { ...mocks.linked, enabled: false };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    expect(mocks.legacy).toHaveBeenCalledWith(PARAMS);
    expect(result.current.pullRequest).toEqual({ number: 1 });
    expect(result.current.pullRequests).toBeUndefined();
  });

  it('never asks for the branch PR under the lab', () => {
    renderHook(() => useSidebarPullRequests(PARAMS));

    expect(mocks.legacy).toHaveBeenCalledWith(
      expect.objectContaining({ gitPath: undefined, isGithub: false, snapshot: undefined }),
    );
  });

  it('lists every linked PR and opens the picked one in the tab', () => {
    const views = [view(3), view(2), view(9, { localDetail: false })];
    mocks.linked = { enabled: true, primary: views[0], probes: [], views };
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
    mocks.linked = { enabled: true, primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    expect(result.current.confirmed).toBe(false);
    result.current.onRetryConfirm?.();
    expect(mocks.refresh).toHaveBeenCalledWith('t1');
  });

  it('keeps a confirmed PR locked when the app cannot vouch for it', () => {
    const views = [view(3, { vouched: false })];
    mocks.linked = { enabled: true, primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests(PARAMS));

    expect(result.current.confirmed).toBe(false);
  });

  it('removes and links PRs on the topic, then refreshes its list', async () => {
    const views = [view(3)];
    mocks.linked = { enabled: true, primary: views[0], probes: [], views };
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
    mocks.linked = { enabled: true, primary: views[0], probes: [], views };
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
    mocks.linked = { enabled: true, primary: views[0], probes: [], views };
    const { result } = renderHook(() => useSidebarPullRequests({ ...PARAMS, topicId: null }));

    expect(result.current.linkPullRequest).toBeUndefined();
    expect(result.current.dismissPullRequest).toBeUndefined();
  });
});
