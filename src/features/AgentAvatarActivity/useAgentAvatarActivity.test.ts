import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import type { Operation } from '@/store/chat/slices/operation/types';

import { AGENT_AVATAR_DONE_MS, useAgentAvatarActivity } from './useAgentAvatarActivity';

const setRun = (
  status?: Operation['status'],
  metadata?: Record<string, unknown>,
  agentId = 'agent',
) => {
  const run = {
    context: { agentId },
    id: 'run',
    metadata: { startTime: 1, ...metadata },
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

  // A client run hides its loading state first and is marked completed a moment later.
  it('celebrates a run that is marked completed after it stopped showing as busy', () => {
    const { result } = renderHook(() => useAgentAvatarActivity('agent'));

    setRun('running');
    setRun('running', { visibleLoadingDone: true });
    expect(result.current.state).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    setRun('completed', { visibleLoadingDone: true });
    expect(result.current.state).toBe('done');
  });

  it('does not celebrate a run already completed before it mounted', () => {
    setRun('completed');
    const { result } = renderHook(() => useAgentAvatarActivity('agent'));
    expect(result.current.state).toBeUndefined();
  });

  it('does not carry a celebration over to another Agent', () => {
    const { rerender, result } = renderHook(({ id }) => useAgentAvatarActivity(id), {
      initialProps: { id: 'agent' },
    });
    setRun('running');
    setRun('completed');
    expect(result.current.state).toBe('done');

    rerender({ id: 'other' });
    expect(result.current.state).toBeUndefined();
  });

  it('does not credit a running Agent with the completed run of the next one', () => {
    const { rerender, result } = renderHook(({ id }) => useAgentAvatarActivity(id), {
      initialProps: { id: 'agent' },
    });
    setRun('running');
    expect(result.current.state).toBe('working');

    setRun('completed', undefined, 'other');
    rerender({ id: 'other' });
    expect(result.current.state).toBeUndefined();
  });

  it.each(['failed', 'cancelled'] as const)('does not celebrate a %s run', (status) => {
    const { result } = renderHook(() => useAgentAvatarActivity('agent'));

    setRun('running');
    setRun(status);
    expect(result.current.state).toBeUndefined();
  });
});
