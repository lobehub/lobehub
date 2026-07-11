import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSubmitSupplement } from './useSubmitSupplement';

const mocks = vi.hoisted(() => ({
  submitSupplement: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: mocks.toastError },
}));

vi.mock('@/services/onboardingAnalysis', () => ({
  onboardingAnalysisService: {
    submitSupplement: mocks.submitSupplement,
  },
}));

beforeEach(() => {
  mocks.submitSupplement.mockReset().mockResolvedValue(undefined);
  mocks.toastError.mockClear();
});

describe('useSubmitSupplement', () => {
  it('closes optimistically and calls the service with trimmed text', async () => {
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useSubmitSupplement(onSubmitted));

    await act(async () => {
      await result.current.submit('  extra context  ');
    });

    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(mocks.submitSupplement).toHaveBeenCalledWith('extra context');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('does nothing for blank text', async () => {
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useSubmitSupplement(onSubmitted));

    await act(async () => {
      await result.current.submit('   ');
    });

    expect(onSubmitted).not.toHaveBeenCalled();
    expect(mocks.submitSupplement).not.toHaveBeenCalled();
  });

  it('toasts an error when the service call fails after the optimistic close', async () => {
    mocks.submitSupplement.mockRejectedValue(new Error('not implemented'));
    const onSubmitted = vi.fn();
    const { result } = renderHook(() => useSubmitSupplement(onSubmitted));

    await act(async () => {
      await result.current.submit('extra context');
    });

    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});
