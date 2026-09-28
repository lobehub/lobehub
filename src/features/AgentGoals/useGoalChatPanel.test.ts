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
    act(() => result.current.openSupervision(manager));
    expect(result.current).toMatchObject({ open: true, ...manager });
    const firstRequest = result.current.request;
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
    act(() => result.current.openSupervision(manager));
    expect(result.current).toMatchObject({ open: true, ...manager });
    expect(result.current.request).not.toBe(firstRequest);
  });

  it('never carries another goal’s open panel or creator into the next goal', () => {
    const { result, rerender } = renderHook(({ id, agent }) => useGoalChatPanel(id, agent), {
      initialProps: { id: 'goal-a', agent: 'worker-a' },
    });
    act(() => result.current.openSupervision(manager));
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
