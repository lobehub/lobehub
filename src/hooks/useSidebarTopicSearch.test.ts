import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSidebarTopicSearch } from './useSidebarTopicSearch';

const mocks = vi.hoisted(() => ({
  onlyMine: false,
  useSearchTopics: vi.fn(),
}));

vi.mock('@/hooks/useTopicOnlyMine', () => ({ useTopicOnlyMine: () => mocks.onlyMine }));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({ activeAgentId: 'agt_1', useSearchTopics: mocks.useSearchTopics }),
}));

describe('useSidebarTopicSearch', () => {
  beforeEach(() => {
    mocks.onlyMine = false;
    mocks.useSearchTopics.mockClear();
  });

  /** @example With "only mine" on, sidebar searches must not bring back teammates' topics. */
  it('searches the active agent with the workspace only-mine filter', () => {
    mocks.onlyMine = true;

    renderHook(() => useSidebarTopicSearch('release'));

    expect(mocks.useSearchTopics).toHaveBeenLastCalledWith('release', {
      agentId: 'agt_1',
      onlyMine: true,
    });
  });

  it('searches unfiltered when the filter is off', () => {
    renderHook(() => useSidebarTopicSearch('release'));

    expect(mocks.useSearchTopics).toHaveBeenLastCalledWith('release', {
      agentId: 'agt_1',
      onlyMine: false,
    });
  });
});
