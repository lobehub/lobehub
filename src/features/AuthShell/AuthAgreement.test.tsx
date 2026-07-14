import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AuthAgreement, { useAuthAgreement } from './AuthAgreement';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

describe('AuthAgreement', () => {
  it('should keep the agreement visible without an email form control', () => {
    render(<AuthAgreement />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('footer.agreement')).toBeTruthy();
  });
});

describe('useAuthAgreement', () => {
  it('should keep the agreement unchecked when confirmation is cancelled', () => {
    const requestConfirmation = vi.fn();
    const continueAction = vi.fn();
    const { result } = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(result.current.agreementChecked).toBe(false);
    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(continueAction).not.toHaveBeenCalled();
  });

  it('should check the agreement and reuse consent after confirmation', () => {
    const requestConfirmation = vi.fn((onConfirm: () => void) => onConfirm());
    const continueAction = vi.fn();
    const { result } = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(result.current.agreementChecked).toBe(true);

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(continueAction).toHaveBeenCalledTimes(2);
  });

  it('should skip confirmation when the agreement is checked manually', () => {
    const requestConfirmation = vi.fn();
    const continueAction = vi.fn();
    const { result } = renderHook(() => useAuthAgreement(requestConfirmation));

    act(() => {
      result.current.setAgreementChecked(true);
    });

    act(() => {
      result.current.continueWithAgreement(continueAction);
    });

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(continueAction).toHaveBeenCalledOnce();
  });
});
