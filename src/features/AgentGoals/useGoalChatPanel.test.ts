import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useGoalChatPanel } from './useGoalChatPanel';

const manager = { agentId: 'creator', topicId: 'persistent-supervision' };

describe('useGoalChatPanel', () => {
  it('starts collapsed and replaces the responsible conversation with supervision', () => {
    const { result } = renderHook(() => useGoalChatPanel('goal-a', 'worker'));
    expect(result.current.open).toBe(false);
    expect(result.current.agentId).toBe('worker');
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    act(() => result.current.openConversation(manager));
    expect(result.current).toMatchObject({ open: true, ...manager });
    const firstRequest = result.current.request;
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    act(() => result.current.openConversation(manager));
    expect(result.current).toMatchObject({ open: true, ...manager });
    expect(result.current.request).not.toBe(firstRequest);
  });

  // The same destination carries both panel contents: a target without a topic
  // means the agent's side conversation, which is how a managed goal's record
  // hands the reader back an editable chat.
  it('opens the agent’s side conversation when the target names no topic', () => {
    const { result } = renderHook(() => useGoalChatPanel('goal-a'));

    act(() => result.current.openConversation({ agentId: 'worker' }));

    expect(result.current).toMatchObject({ agentId: 'worker', open: true });
    expect(result.current.topicId).toBeUndefined();
  });

  // The result page's composer hands its text to the panel; a later reopen must
  // not replay it, so the message rides only the request that carried it.
  it('carries a composed message only on the request that sent it', () => {
    const { result } = renderHook(() => useGoalChatPanel('goal-a', 'worker'));

    act(() => result.current.openConversation({ agentId: 'worker', initialMessage: 'next?' }));
    expect(result.current).toMatchObject({ initialMessage: 'next?', open: true });

    act(() => result.current.setOpen(false));
    act(() => result.current.setOpen(true));
    expect(result.current.initialMessage).toBeUndefined();
  });

  it('never carries another goal’s open panel or creator into the next goal', () => {
    const { result, rerender } = renderHook(({ id, agent }) => useGoalChatPanel(id, agent), {
      initialProps: { id: 'goal-a', agent: 'worker-a' },
    });
    act(() => result.current.openConversation(manager));
    rerender({ id: 'goal-b', agent: 'worker-b' });
    expect(result.current).toMatchObject({ open: false, agentId: 'worker-b' });
    expect(result.current.topicId).toBeUndefined();
    rerender({ id: 'goal-a', agent: 'worker-a' });
    expect(result.current.open).toBe(false);
    rerender({ id: 'goal-b', agent: 'worker-b' });
    act(() => result.current.setOpen(true));
    expect(result.current).toMatchObject({ open: true, agentId: 'worker-b' });
  });
});
