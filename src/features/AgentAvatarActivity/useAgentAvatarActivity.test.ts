import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import type { Operation } from '@/store/chat/slices/operation/types';

import { AGENT_AVATAR_DONE_MS, useAgentAvatarActivity } from './useAgentAvatarActivity';

const setRun = (status?: Operation['status']) => {
  const run = {
    context: { agentId: 'agent' },
    id: 'run',
    metadata: { startTime: 1 },
    status,
    type: 'execAgentRuntime',
  } as unknown as Operation;
  act(() => {
    useChatStore.setState({
      operations: status ? { run } : {},
      operationsByType: (status ? { execAgentRuntime: ['run'] } : {}) as never,
    });
  });
};

describe('useAgentAvatarActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChatStore.setState({ operations: {}, operationsByType: {} as never, topicDataMap: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays still until hovered, then idles and follows the pointer', () => {
    const { result } = renderHook(() => useAgentAvatarActivity('agent'));
    expect(result.current.avatar).toEqual({
      animated: false,
      followPointer: false,
      state: undefined,
    });

    act(() => result.current.hover.onMouseEnter());
    expect(result.current.avatar).toMatchObject({ animated: true, followPointer: true });

    act(() => result.current.hover.onMouseLeave());
    expect(result.current.avatar).toMatchObject({ animated: false, followPointer: false });
  });

  it('plays the run, celebrates a completed one briefly, then idles', () => {
    const { result } = renderHook(() => useAgentAvatarActivity('agent'));

    setRun('running');
    expect(result.current.avatar).toMatchObject({ animated: true, state: 'working' });

    setRun('completed');
    expect(result.current.state).toBe('done');

    act(() => {
      vi.advanceTimersByTime(AGENT_AVATAR_DONE_MS);
    });
    expect(result.current.state).toBeUndefined();
    expect(result.current.avatar.animated).toBe(false);
  });

  it.each(['failed', 'cancelled'] as const)('does not celebrate a %s run', (status) => {
    const { result } = renderHook(() => useAgentAvatarActivity('agent'));

    setRun('running');
    setRun(status);
    expect(result.current.state).toBeUndefined();
  });
});
