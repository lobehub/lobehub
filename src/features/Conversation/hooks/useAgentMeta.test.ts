import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';

import { useConversationStore } from '../store';
import { useAgentMeta, useIsBuiltinAgent } from './useAgentMeta';

vi.mock('zustand/traditional');

// Mock the ConversationStore
vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return {
    ...actual,
    useConversationStore: vi.fn(),
  };
});

describe('useAgentMeta', () => {
  it('should return agent meta for regular (non-builtin) agents', () => {
    const mockAgentId = 'regular-agent-123';
    const mockMeta = {
      avatar: 'agent-avatar.png',
      backgroundColor: '#ff0000',
      title: 'My Custom Agent',
      description: 'A custom agent',
    };

    // Mock ConversationStore to return agentId
    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockAgentId } };
      return selector(state);
    });

    // Mock AgentStore state
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [mockAgentId]: mockMeta,
        },
        builtinAgentIdMap: {
          inbox: 'inbox-agent-id',
          pageAgent: 'page-agent-id',
        },
      });
    });

    const { result } = renderHook(() => useAgentMeta());

    expect(result.current).toEqual(mockMeta);
    expect(result.current.title).toBe('My Custom Agent');
    expect(result.current.avatar).toBe('agent-avatar.png');
  });

  it('should return Lobe AI title for builtin inbox agent, preserving avatar from backend', () => {
    const mockInboxAgentId = 'inbox-agent-id';
    const mockMeta = {
      avatar: '/icons/icon-lobe.png', // Avatar from backend (merged from builtin-agents package)
      title: 'Original Inbox Title',
      description: 'Inbox description',
    };

    // Mock ConversationStore to return inbox agentId
    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockInboxAgentId } };
      return selector(state);
    });

    // Mock AgentStore state with inbox as builtin agent
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [mockInboxAgentId]: mockMeta,
        },
        builtinAgentIdMap: {
          inbox: mockInboxAgentId,
          pageAgent: 'page-agent-id',
        },
      });
    });

    const { result } = renderHook(() => useAgentMeta());

    // Should override title with Lobe AI, but preserve avatar from backend
    expect(result.current.avatar).toBe('/icons/icon-lobe.png');
    expect(result.current.title).toBe('Lobe AI');
    // Should preserve other properties
    expect(result.current.description).toBe('Inbox description');
  });

  it('should return Lobe AI title for page agent (builtin), preserving avatar from backend', () => {
    const mockPageAgentId = 'page-agent-id';
    const mockMeta = {
      avatar: '/icons/icon-lobe.png', // Avatar from backend (merged from builtin-agents package)
      title: 'Page Agent Title',
    };

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockPageAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        agentMap: {
          [mockPageAgentId]: mockMeta,
        },
        builtinAgentIdMap: {
          inbox: 'inbox-agent-id',
          pageAgent: mockPageAgentId,
        },
      });
    });

    const { result } = renderHook(() => useAgentMeta());

    // Should override title with Lobe AI, but preserve avatar from backend
    expect(result.current.avatar).toBe('/icons/icon-lobe.png');
    expect(result.current.title).toBe('Lobe AI');
  });

  it('should handle empty agentMap gracefully', () => {
    const mockAgentId = 'non-existent-agent';

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        agentMap: {},
        builtinAgentIdMap: {},
      });
    });

    const { result } = renderHook(() => useAgentMeta());

    // Should return empty object or undefined properties
    expect(result.current).toBeDefined();
  });

  it('should use messageAgentId when provided instead of context agentId', () => {
    const contextAgentId = 'context-agent-123';
    const messageAgentId = 'message-agent-456';
    const contextMeta = {
      avatar: 'context-avatar.png',
      title: 'Context Agent',
    };
    const messageMeta = {
      avatar: 'message-avatar.png',
      title: 'Message Agent',
    };

    // Mock ConversationStore to return context agentId
    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: contextAgentId } };
      return selector(state);
    });

    // Mock AgentStore state with both agents
    act(() => {
      useAgentStore.setState({
        agentMap: {
          [contextAgentId]: contextMeta,
          [messageAgentId]: messageMeta,
        },
        builtinAgentIdMap: {},
      });
    });

    // When messageAgentId is provided, should use that agent's meta
    const { result } = renderHook(() => useAgentMeta(messageAgentId));

    expect(result.current).toMatchObject(messageMeta);
    expect(result.current.title).toBe('Message Agent');
    expect(result.current.avatar).toBe('message-avatar.png');
  });

  it('should fallback to context agentId when messageAgentId is null', () => {
    const contextAgentId = 'context-agent-123';
    const contextMeta = {
      avatar: 'context-avatar.png',
      title: 'Context Agent',
    };

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: contextAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        agentMap: {
          [contextAgentId]: contextMeta,
        },
        builtinAgentIdMap: {},
      });
    });

    // When messageAgentId is null, should fallback to context agentId
    const { result } = renderHook(() => useAgentMeta(null));

    expect(result.current).toMatchObject(contextMeta);
    expect(result.current.title).toBe('Context Agent');
  });

  it('should fallback to context agentId when messageAgentId is undefined', () => {
    const contextAgentId = 'context-agent-123';
    const contextMeta = {
      avatar: 'context-avatar.png',
      title: 'Context Agent',
    };

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: contextAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        agentMap: {
          [contextAgentId]: contextMeta,
        },
        builtinAgentIdMap: {},
      });
    });

    // When messageAgentId is undefined, should fallback to context agentId
    const { result } = renderHook(() => useAgentMeta(undefined));

    expect(result.current).toMatchObject(contextMeta);
    expect(result.current.title).toBe('Context Agent');
  });
});

describe('useIsBuiltinAgent', () => {
  it('should return true for inbox agent', () => {
    const mockInboxAgentId = 'inbox-agent-id';

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockInboxAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        builtinAgentIdMap: {
          inbox: mockInboxAgentId,
          pageAgent: 'page-agent-id',
        },
      });
    });

    const { result } = renderHook(() => useIsBuiltinAgent());

    expect(result.current).toBe(true);
  });

  it('should return true for page agent', () => {
    const mockPageAgentId = 'page-agent-id';

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockPageAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        builtinAgentIdMap: {
          inbox: 'inbox-agent-id',
          pageAgent: mockPageAgentId,
        },
      });
    });

    const { result } = renderHook(() => useIsBuiltinAgent());

    expect(result.current).toBe(true);
  });

  it('should return false for regular (non-builtin) agent', () => {
    const mockRegularAgentId = 'regular-agent-123';

    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: mockRegularAgentId } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        builtinAgentIdMap: {
          inbox: 'inbox-agent-id',
          pageAgent: 'page-agent-id',
        },
      });
    });

    const { result } = renderHook(() => useIsBuiltinAgent());

    expect(result.current).toBe(false);
  });

  it('should return false when builtinAgentIdMap is empty', () => {
    vi.mocked(useConversationStore).mockImplementation((selector: any) => {
      const state = { context: { agentId: 'some-agent' } };
      return selector(state);
    });

    act(() => {
      useAgentStore.setState({
        builtinAgentIdMap: {},
      });
    });

    const { result } = renderHook(() => useIsBuiltinAgent());

    expect(result.current).toBe(false);
  });
});
