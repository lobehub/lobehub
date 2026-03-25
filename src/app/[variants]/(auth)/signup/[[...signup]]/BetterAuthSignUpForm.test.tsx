import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BetterAuthSignUpForm from './BetterAuthSignUpForm';

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key: string) => {
      if (key === 'betterAuth.signin.usePhone') return 'Use phone number';
      return key;
    }),
  })),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams('callbackUrl=%2Fchat')),
}));

vi.mock('./useSignUp', () => ({
  useSignUp: vi.fn(() => ({
    businessElement: null,
    loading: false,
    onSubmit: vi.fn(),
  })),
}));

vi.mock('../../_layout/AuthServerConfigProvider', () => ({
  useAuthServerConfigStore: vi.fn((selector) =>
    selector({
      serverConfig: { enablePhoneAuth: true },
    }),
  ),
}));

describe('BetterAuthSignUpForm', () => {
  it('shows a phone entry when phone auth is enabled', () => {
    render(<BetterAuthSignUpForm />);

    const phoneLink = screen.getByRole('link', { name: 'Use phone number' });

    expect(phoneLink).toHaveAttribute('href', '/signin?callbackUrl=%2Fchat&mode=phone');
  });
});
