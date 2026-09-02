import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyEmail } from './useVerifyEmail';

const mockSendVerificationEmail = vi.hoisted(() => vi.fn());

vi.mock('@/libs/better-auth/auth-client', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useVerifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendVerificationEmail.mockResolvedValue({ error: null });
  });

  it('should bind the verification callback to the current auth origin', async () => {
    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/onboarding', email: 'user@example.com' }),
    );

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      callbackURL: `${window.location.origin}/onboarding`,
      email: 'user@example.com',
    });
  });
});
