import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentTransferJob } from './useAgentTransferJob';

const mocks = vi.hoisted(() => ({
  chatSelectors: [] as ((state: { activeTopicId?: string }) => unknown)[],
  data: null as null | { pendingTopicIds: string[] },
  mutate: vi.fn(),
}));

vi.mock('@/libs/swr', () => ({
  useClientPollingSWR: () => ({ data: mocks.data, mutate: mocks.mutate }),
}));
vi.mock('@/services/agent', () => ({ agentService: {} }));
vi.mock('@/services/chatGroup', () => ({ chatGroupService: {} }));
vi.mock('@/store/chat', () => ({
  getChatStoreState: () => ({}),
  useChatStore: (selector: (state: { activeTopicId?: string }) => unknown) => {
    mocks.chatSelectors.push(selector);
    return selector({ activeTopicId: 'topic-a' });
  },
}));
vi.mock('@/store/chat/selectors', () => ({ topicSelectors: {} }));

const selectedTopic = (activeTopicId: string) =>
  mocks.chatSelectors.map((selector) => selector({ activeTopicId }));

describe('useAgentTransferJob', () => {
  beforeEach(() => {
    mocks.chatSelectors.length = 0;
    mocks.mutate.mockReset();
  });

  it('does not depend on the active topic while no job is pending', () => {
    mocks.data = null;
    renderHook(() => useAgentTransferJob({ agentId: 'agent-1' }));

    // Every sidebar topic row mounts this hook, so it must not re-render them on a switch.
    expect(selectedTopic('topic-a')).toEqual(selectedTopic('topic-b'));
  });

  it('follows the active topic while a job is pending', () => {
    mocks.data = { pendingTopicIds: ['topic-a'] };
    renderHook(() => useAgentTransferJob({ agentId: 'agent-1' }));

    expect(selectedTopic('topic-a')).not.toEqual(selectedTopic('topic-b'));
    expect(mocks.mutate).toHaveBeenCalled();
  });
});
