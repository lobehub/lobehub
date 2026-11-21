import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSubTopicTreeSync } from './useSubTopicTreeSync';

const mocks = vi.hoisted(() => ({
  nodes: [] as { state: string }[],
  refreshSubTopics: vi.fn(),
  useFetchSubTopics: vi.fn(),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: any) => unknown) =>
    selector({
      refreshSubTopics: mocks.refreshSubTopics,
      subTopicTreeMap: { tpc_parent: mocks.nodes },
      useFetchSubTopics: mocks.useFetchSubTopics,
    }),
}));

/**
 * Regression: the tree only polled while an already-known sub-topic was in
 * flight, so a child the parent opened server-side (`lh topic send --new`) —
 * even one waiting for approval — stayed unseen until something else
 * refreshed the tree.
 */
describe('useSubTopicTreeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nodes = [];
  });

  it('polls while a parent is running, even with no sub-topic known yet', () => {
    renderHook(() => useSubTopicTreeSync(true, ['tpc_parent'], true));

    expect(mocks.useFetchSubTopics).toHaveBeenCalledWith(true, ['tpc_parent'], true);
  });

  it('polls while a known sub-topic is in flight, and not otherwise', () => {
    mocks.nodes = [{ state: 'idle' }];
    const { rerender } = renderHook(() => useSubTopicTreeSync(true, ['tpc_parent'], false));
    expect(mocks.useFetchSubTopics).toHaveBeenLastCalledWith(true, ['tpc_parent'], false);

    mocks.nodes = [{ state: 'waiting_for_user' }];
    rerender();
    expect(mocks.useFetchSubTopics).toHaveBeenLastCalledWith(true, ['tpc_parent'], true);
  });

  it('reads the tree once more when the parent stops running', () => {
    const { rerender } = renderHook(
      ({ running }) => useSubTopicTreeSync(true, ['tpc_parent'], running),
      { initialProps: { running: true } },
    );
    expect(mocks.refreshSubTopics).not.toHaveBeenCalled();

    rerender({ running: false });
    expect(mocks.refreshSubTopics).toHaveBeenCalledTimes(1);

    rerender({ running: false });
    expect(mocks.refreshSubTopics).toHaveBeenCalledTimes(1);
  });
});
