import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCommandMenuAnalytics } from './commandMenuAnalytics';

describe('useCommandMenuAnalytics', () => {
  it('keeps the no-op callbacks stable across rerenders', () => {
    const input = {
      enabled: true,
      hasError: false,
      hasResponse: false,
      isValidating: false,
      menuContext: 'general',
      resultCount: 0,
      searchQuery: '',
    };
    const { rerender, result } = renderHook(() => useCommandMenuAnalytics(input));
    const initialAnalytics = result.current;

    rerender();

    expect(result.current).toBe(initialAnalytics);
  });
});
