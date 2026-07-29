import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useBusinessConversationAnalytics } from './useBusinessConversationAnalytics';

describe('useBusinessConversationAnalytics', () => {
  it('returns stable empty hooks across rerenders', () => {
    const { result, rerender } = renderHook(() =>
      useBusinessConversationAnalytics({ agentId: 'agent-1' }),
    );
    const initialHooks = result.current;

    rerender();

    expect(result.current).toBe(initialHooks);
    expect(result.current).toEqual({});
  });
});
