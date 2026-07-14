import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AuthAgreement, { useAuthAgreement } from './AuthAgreement';
import AuthFooterLinks from './AuthFooterLinks';

interface TransMockProps {
  components?: Record<string, ReactElement>;
  i18nKey: string;
}

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  Trans: ({ components, i18nKey }: TransMockProps) => (
    <>
      {i18nKey}
      {components?.terms}
      {components?.privacy}
    </>
  ),
}));

const expectLinksToOpenInNewTabs = () => {
  const links = screen.getAllByRole('link');

  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  }
};

describe('AuthAgreement', () => {
  it('should keep the agreement visible and open its links in new tabs', () => {
    render(<AuthAgreement />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('footer.agreement')).toBeTruthy();
    expectLinksToOpenInNewTabs();
  });
});

describe('AuthFooterLinks', () => {
  it('should open its links in new tabs', () => {
    render(<AuthFooterLinks />);

    expectLinksToOpenInNewTabs();
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
