import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAicoBillingChatGate } from './useAicoBillingChatGate';

const useAicoBillingSources = vi.fn();

vi.mock('./useAicoBillingSources', () => ({
  useAicoBillingSources: () => useAicoBillingSources(),
}));

describe('useAicoBillingChatGate', () => {
  beforeEach(() => {
    useAicoBillingSources.mockReset();
  });

  it('fail-closed while billing sources are loading', () => {
    useAicoBillingSources.mockReturnValue({
      activeSource: undefined,
      data: undefined,
      isLoading: true,
    });

    const { result } = renderHook(() => useAicoBillingChatGate());
    expect(result.current.blocked).toBe(true);
    expect(result.current.blockReason).toBeNull();
  });

  it('fail-closed when active source is not resolved yet', () => {
    useAicoBillingSources.mockReturnValue({
      activeSource: undefined,
      data: { sources: [], trialActive: false, trialAvailable: false },
      isLoading: false,
    });

    const { result } = renderHook(() => useAicoBillingChatGate());
    expect(result.current.blocked).toBe(true);
  });
});
