import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveConversationResourceAccess } from './useConversationResourceAccess';

const mocks = vi.hoisted(() => ({
  agentState: {
    agentMap: {
      'agent-1': { visibility: 'public' },
    } as Record<string, { visibility: 'private' | 'public' }>,
    inboxAgentId: 'inbox',
  },
  chatState: {
    activeAgentId: 'agent-1',
    activeGroupId: undefined as string | undefined,
  },
  conversationStore: vi.fn(() => {
    throw new Error('Seems like you have not used zustand provider as an ancestor.');
  }),
  groupState: {
    groupMap: {} as Record<string, { id: string; visibility: 'private' | 'public' }>,
  },
  useResourceAccess: vi.fn(() => ({ canUseResource: true, isLoading: false })),
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: (...args: unknown[]) => mocks.useResourceAccess(...(args as [])),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof mocks.agentState) => unknown) =>
    selector(mocks.agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: (state: typeof mocks.agentState) => state.inboxAgentId,
  },
}));

vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: typeof mocks.groupState) => unknown) =>
    selector(mocks.groupState),
}));

vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: {
    getGroupById: (id: string) => (state: typeof mocks.groupState) => state.groupMap[id],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: typeof mocks.chatState) => unknown) => selector(mocks.chatState),
}));

vi.mock('../store', () => ({
  useConversationStore: mocks.conversationStore,
}));

describe('useActiveConversationResourceAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chatState.activeAgentId = 'agent-1';
    mocks.chatState.activeGroupId = undefined;
    mocks.groupState.groupMap = {};
    mocks.useResourceAccess.mockReturnValue({ canUseResource: true, isLoading: false });
  });

  it('resolves active agent access without reading the ConversationStore provider', () => {
    const { result } = renderHook(() => useActiveConversationResourceAccess());

    expect(result.current.canUseResource).toBe(true);
    expect(result.current.isGroupContext).toBe(false);
    expect(mocks.conversationStore).not.toHaveBeenCalled();
    expect(mocks.useResourceAccess).toHaveBeenCalledWith('agent', 'agent-1');
  });

  it('resolves an active group without reading the ConversationStore provider', () => {
    mocks.chatState.activeGroupId = 'group-1';
    mocks.groupState.groupMap = {
      'group-1': { id: 'group-1', visibility: 'public' },
    };

    const { result } = renderHook(() => useActiveConversationResourceAccess());

    expect(result.current.isGroupContext).toBe(true);
    expect(mocks.conversationStore).not.toHaveBeenCalled();
    expect(mocks.useResourceAccess).toHaveBeenCalledWith('agentGroup', 'group-1');
  });
});
