import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAgentToReopen } from './useAgentToReopen';

// The switcher lists agents most-lessons first; `many` leads, `few` is what onboarding opens.
const agentKeys = ['agent:many', 'agent:few'];

describe('useAgentToReopen', () => {
  it('reopens an agent opened from outside the switcher, not the count leader', () => {
    const { rerender, result } = renderHook(({ value }) => useAgentToReopen(value, agentKeys), {
      initialProps: { value: 'agent:few' },
    });
    rerender({ value: 'mine' });

    expect(result.current).toBe('agent:few');
  });

  it('opens the agent that learned the most when none was viewed yet', () => {
    const { result } = renderHook(() => useAgentToReopen('mine', agentKeys));

    expect(result.current).toBe('agent:many');
  });

  it('falls back to the leader when the remembered agent is gone', () => {
    const { rerender, result } = renderHook(({ keys, value }) => useAgentToReopen(value, keys), {
      initialProps: { keys: agentKeys, value: 'agent:few' },
    });
    rerender({ keys: ['agent:many'], value: 'mine' });

    expect(result.current).toBe('agent:many');
  });
});
