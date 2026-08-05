import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useMasonryViewState } from './useMasonryViewState';

describe('useMasonryViewState', () => {
  it('shows skeleton while navigating even before SWR starts validating', () => {
    const { result } = renderHook(() =>
      useMasonryViewState({
        dataLength: 4,
        isLoading: false,
        isNavigating: true,
        isValidating: false,
        viewMode: 'masonry',
      }),
    );

    expect(result.current.showSkeleton).toBe(true);
    expect(result.current.isMasonryReady).toBe(false);
  });
});
