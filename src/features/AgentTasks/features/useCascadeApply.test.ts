import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCascadeApply } from './TaskStatusCascadeModal';

const toastError = vi.hoisted(() => vi.fn());
const modalContext = vi.hoisted(() => ({
  close: vi.fn(),
  setCanDismissByClickOutside: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: { error: toastError },
  useModalContext: () => modalContext,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useCascadeApply', () => {
  it('keeps the modal open with an error toast on apply failure, then closes on retry success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onApply = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useCascadeApply(onApply));

    // First attempt fails: the rejection is surfaced instead of discarded,
    // and the modal is not closed so the user can retry or cancel.
    await act(() => result.current.handleApply(true));
    expect(toastError).toHaveBeenCalledWith('taskDetail.statusCascade.applyFailed');
    expect(modalContext.close).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.loadingAction).toBeNull());

    // Retry succeeds: the modal closes.
    await act(() => result.current.handleApply(true));
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(modalContext.close).toHaveBeenCalledTimes(1);
  });
});
