import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useIsSingleMode } from './useIsSingleMode';

// Mock react-router-dom useSearchParams (via the wrapper hook)
const mockUseSearchParams = vi.hoisted(() => vi.fn());
vi.mock('@/libs/router/navigation', () => ({
  useSearchParams: mockUseSearchParams,
}));

describe('useIsSingleMode', () => {
  it('should return false initially (during SSR)', () => {
    const mockSearchParams = new URLSearchParams('mode=single');
    mockUseSearchParams.mockReturnValue([mockSearchParams, vi.fn()]);

    const { result } = renderHook(() => useIsSingleMode());

    // In test environment, useEffect runs synchronously, so it will immediately detect single mode
    expect(result.current).toBe(true);
  });

  it('should return true when mode=single', () => {
    const mockSearchParams = new URLSearchParams('mode=single');
    mockUseSearchParams.mockReturnValue([mockSearchParams, vi.fn()]);

    const { result } = renderHook(() => useIsSingleMode());

    // Should immediately detect single mode in test environment
    expect(result.current).toBe(true);
  });

  it('should return false when mode is not single', () => {
    const mockSearchParams = new URLSearchParams('mode=normal');
    mockUseSearchParams.mockReturnValue([mockSearchParams, vi.fn()]);

    const { result } = renderHook(() => useIsSingleMode());

    // Should return false for non-single mode
    expect(result.current).toBe(false);
  });

  it('should return false when no mode parameter exists', () => {
    const mockSearchParams = new URLSearchParams();
    mockUseSearchParams.mockReturnValue([mockSearchParams, vi.fn()]);

    const { result } = renderHook(() => useIsSingleMode());

    // Should return false when no mode parameter
    expect(result.current).toBe(false);
  });
});