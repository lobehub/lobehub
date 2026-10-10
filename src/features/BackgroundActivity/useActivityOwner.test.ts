import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

import { useActivityOwner } from './useActivityOwner';

vi.mock('@/services/electron/devtools', () => ({ electronDevtoolsService: {} }));

describe('useActivityOwner', () => {
  const fetchAgent = vi.fn();
  const fetchTopic = vi.fn();

  beforeEach(() => {
    fetchAgent.mockReset();
    fetchTopic.mockReset();
    useAgentStore.setState({ agentMap: {}, useFetchAgentConfig: fetchAgent as any });
    useChatStore.setState({
      topicDataMap: {},
      topicDetailMap: {},
      useFetchTopicDetail: fetchTopic as any,
    });
  });

  it('hydrates a missing owner and updates once the agent and topic load', () => {
    const { result } = renderHook(() =>
      useActivityOwner({ agentId: 'agent-1', topicId: 'topic-1' }),
    );
    expect(result.current).toEqual({ agent: undefined, topic: undefined });
    expect(fetchAgent).toHaveBeenLastCalledWith(true, 'agent-1');
    expect(fetchTopic).toHaveBeenLastCalledWith('topic-1');

    act(() => {
      useAgentStore.setState({ agentMap: { 'agent-1': { title: 'Coder' } as any } });
      useChatStore.setState({ topicDetailMap: { 'topic-1': { title: 'Fix auth' } as any } });
    });

    expect(result.current).toEqual({ agent: 'Coder', topic: 'Fix auth' });
    expect(fetchAgent).toHaveBeenLastCalledWith(true, '');
  });

  it('fetches nothing for an unowned activity', () => {
    const { result } = renderHook(() => useActivityOwner({}));
    expect(result.current).toEqual({ agent: undefined, topic: undefined });
    expect(fetchAgent).toHaveBeenLastCalledWith(true, '');
    expect(fetchTopic).toHaveBeenLastCalledWith(undefined);
  });
});
