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
vi.mock('@/services/work', () => ({ workService: { refreshTopicPullRequests: mocks.refresh } }));
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
});
