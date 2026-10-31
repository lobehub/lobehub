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
  // Folding the panel before the history loads must not lose a message the
  // result composer has already cleared from its own editor.
  it('keeps a pending message across folding the panel until it is consumed', () => {
    const { result } = renderHook(() => useGoalChatPanel('goal-a', 'worker'));

    act(() => result.current.openConversation({ agentId: 'worker', initialMessage: 'next?' }));
    expect(result.current).toMatchObject({ initialMessage: 'next?', open: true });

    act(() => result.current.setOpen(false));
    act(() => result.current.setOpen(true));
    expect(result.current.initialMessage).toBe('next?');

    act(() => result.current.consumeInitialMessage());
    expect(result.current.initialMessage).toBeUndefined();
  });

  // The panel remounts whenever a drill-down replaces it; once the message has
  // gone out, the host must stop handing it over, or the return trip resends it.
  it('drops a dispatched message without remounting the panel', () => {
    const { result } = renderHook(() => useGoalChatPanel('goal-a', 'worker'));

    act(() => result.current.openConversation({ agentId: 'worker', initialMessage: 'next?' }));
    const request = result.current.request;
    act(() => result.current.consumeInitialMessage());

    expect(result.current.initialMessage).toBeUndefined();
    expect(result.current).toMatchObject({ agentId: 'worker', open: true, request });
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

  // Sending a plan back hands the correction to the main Agent, whose turn may
  // be the one that opens the supervision record; the panel must end up there,
  // not on the side conversation it opened while the record did not exist.
  it('moves to the supervision record once the awaited record exists', () => {
    const { rerender, result } = renderHook(
      ({ record }: { record?: typeof manager }) => useGoalChatPanel('goal-a', 'creator', record),
      { initialProps: {} as { record?: typeof manager } },
    );

    act(() => result.current.openAwaitingRecord({ agentId: 'creator' }));
    expect(result.current).toMatchObject({ agentId: 'creator', awaitingRecord: true, open: true });
    expect(result.current.topicId).toBeUndefined();
    const fallbackRequest = result.current.request;

    rerender({ record: manager });
    expect(result.current).toMatchObject({ awaitingRecord: false, open: true, ...manager });
    expect(result.current.request).not.toBe(fallbackRequest);

    // Followed once: closing the panel later does not get it reopened.
    act(() => result.current.setOpen(false));
    rerender({ record: manager });
    expect(result.current.open).toBe(false);
  });

  it('does not move to a record nobody is waiting for', () => {
    const { rerender, result } = renderHook(
      ({ record }: { record?: typeof manager }) => useGoalChatPanel('goal-a', 'creator', record),
      { initialProps: {} as { record?: typeof manager } },
    );

    act(() => result.current.openConversation({ agentId: 'creator' }));
    rerender({ record: manager });

    expect(result.current.topicId).toBeUndefined();
  });

  // The main Agent may never take the correction up (no turn left, goal paused):
  // waiting gives way to the conversation the panel opened on.
  it('stays on the opened conversation once it stops waiting', () => {
    const { result } = renderHook(() => useGoalChatPanel('goal-a', 'creator'));

    act(() => result.current.openAwaitingRecord({ agentId: 'creator' }));
    act(() => result.current.stopAwaitingRecord());

    expect(result.current).toMatchObject({ agentId: 'creator', awaitingRecord: false, open: true });
    expect(result.current.topicId).toBeUndefined();
  });
});
