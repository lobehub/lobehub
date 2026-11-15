import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationContextSync } from './ConversationContextLoader';

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  memoryEnabled: true,
  useFetchAgentConfig: vi.fn(),
  useFetchDocuments: vi.fn(),
  useFetchTopicMemories: vi.fn(),
}));

vi.mock('../../store', () => ({
  useConversationStore: (selector: (s: { context: Record<string, unknown> }) => unknown) =>
    selector({ context: mocks.context }),
}));
vi.mock('@/hooks/useFetchMemoryForTopic', () => ({
  useFetchTopicMemories: mocks.useFetchTopicMemories,
}));
vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: object) => unknown) =>
    selector({ useFetchAgentConfig: mocks.useFetchAgentConfig }),
}));
vi.mock('@/store/notebook', () => ({
  useNotebookStore: (selector: (s: object) => unknown) =>
    selector({ useFetchDocuments: mocks.useFetchDocuments }),
}));
vi.mock('@/store/user', () => ({
  useUserStore: (selector: () => unknown) => selector(),
}));
vi.mock('@/store/user/selectors', () => ({
  authSelectors: { isLogin: () => true },
  settingsSelectors: { memoryEnabled: () => mocks.memoryEnabled },
}));

describe('useConversationContextSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memoryEnabled = true;
  });

  it('starts the agent config, notebook and memory syncs for the topic', () => {
    mocks.context = { agentId: 'agt_1', threadId: null, topicId: 'tpc_1' };

    renderHook(() => useConversationContextSync());

    expect(mocks.useFetchAgentConfig).toHaveBeenCalledWith(true, 'agt_1');
    expect(mocks.useFetchDocuments).toHaveBeenCalledWith('tpc_1');
    expect(mocks.useFetchTopicMemories).toHaveBeenCalledWith('tpc_1');
  });

  it('skips memories when user memory is disabled', () => {
    mocks.context = { agentId: 'agt_1', threadId: null, topicId: 'tpc_1' };
    mocks.memoryEnabled = false;

    renderHook(() => useConversationContextSync());

    expect(mocks.useFetchTopicMemories).toHaveBeenCalledWith(undefined);
  });

  it('skips owner-scoped syncs on an agent share page', () => {
    mocks.context = { agentId: 'agt_1', agentShareId: 'shr_1', threadId: null, topicId: 'tpc_1' };

    renderHook(() => useConversationContextSync());

    expect(mocks.useFetchAgentConfig).toHaveBeenCalledWith(false, 'agt_1');
    expect(mocks.useFetchDocuments).toHaveBeenCalledWith(undefined);
    expect(mocks.useFetchTopicMemories).toHaveBeenCalledWith(undefined);
  });

  it('skips notebook and memories but keeps agent config on a topic share page', () => {
    mocks.context = { agentId: 'agt_1', threadId: null, topicId: 'tpc_1', topicShareId: 'shr_1' };

    renderHook(() => useConversationContextSync());

    expect(mocks.useFetchAgentConfig).toHaveBeenCalledWith(true, 'agt_1');
    expect(mocks.useFetchDocuments).toHaveBeenCalledWith(undefined);
    expect(mocks.useFetchTopicMemories).toHaveBeenCalledWith(undefined);
  });
});
