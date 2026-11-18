// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePullRequestLink } from './usePullRequestLink';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  items: {} as Record<string, { identifier: string }[]>,
  link: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: mocks.error, success: mocks.success },
}));

vi.mock('@/services/work', () => ({
  workService: { linkTopicPullRequest: mocks.link, refreshTopicPullRequests: mocks.refresh },
}));

vi.mock('@/store/work', () => ({
  useWorkStore: (select: (state: typeof mocks.items) => unknown) => select(mocks.items),
  workActions: { useFetchTopicPullRequests: vi.fn() },
  workSelectors: {
    topicPullRequests: (topicId: string) => (state: typeof mocks.items) => state[topicId],
  },
}));

const TOPIC = 'tpc_test';
const PR = 'LobeHub/lobehub#42';
const URL = 'https://github.com/LobeHub/lobehub/pull/42';
const useTestPullRequest = () => usePullRequestLink(TOPIC, PR, URL);

describe('usePullRequestLink', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.items = { [TOPIC]: [] };
  });

  it('waits for the current topic list and treats an existing PR as linked regardless of casing', () => {
    mocks.items = { tpc_other: [{ identifier: PR }] };
    const { result, rerender } = renderHook(useTestPullRequest);
    expect(result.current.canLink).toBe(false);

    mocks.items[TOPIC] = [{ identifier: 'lobehub/other#42' }];
    rerender();
    expect(result.current.canLink).toBe(true);

    mocks.items[TOPIC] = [{ identifier: PR.toLowerCase() }];
    rerender();
    expect(result.current.canLink).toBe(false);
  });

  it('writes once for repeated clicks and notices the link when the shared list refreshes', async () => {
    mocks.link.mockResolvedValue({ identifier: PR, linked: true });
    mocks.refresh.mockImplementation(async () => {
      mocks.items[TOPIC] = [{ identifier: PR }];
    });
    const { result, rerender } = renderHook(useTestPullRequest);

    await act(async () => {
      await Promise.all([result.current.link(), result.current.link()]);
    });

    expect(mocks.link).toHaveBeenCalledExactlyOnceWith({
      source: 'manual',
      topicId: TOPIC,
      url: URL,
    });
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith(TOPIC);
    rerender();
    expect(result.current.canLink).toBe(false);
    expect(mocks.success).toHaveBeenCalledOnce();
  });

  it('keeps a failed link available for retry', async () => {
    mocks.link.mockResolvedValue({ identifier: PR, linked: false });
    const { result } = renderHook(useTestPullRequest);

    await act(async () => {
      await result.current.link();
    });

    expect(result.current.canLink).toBe(true);
    expect(result.current.linking).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
