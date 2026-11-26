import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVerifyEmail } from './useVerifyEmail';

const mockSendVerificationEmail = vi.hoisted(() => vi.fn());

vi.mock('@/libs/better-auth/auth-client', () => ({
  sendVerificationEmail: mockSendVerificationEmail,
}));

const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', () => ({
  toast: { error: mockToastError, success: vi.fn() },
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

  it('should show a failed resend under the button instead of a toast', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSendVerificationEmail.mockResolvedValue({ error: { message: 'smtp down', status: 500 } });

    const { result } = renderHook(() =>
      useVerifyEmail({ callbackUrl: '/onboarding', email: 'user@example.com' }),
    );

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(result.current.resendError).toBe('betterAuth.verifyEmail.resend.failed');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('should tell the user how to recover when the email is unknown', async () => {
    const { result } = renderHook(() => useVerifyEmail({ callbackUrl: '/', email: null }));

    await act(async () => {
      await result.current.handleResendEmail();
    });

    expect(result.current.resendError).toBe('betterAuth.verifyEmail.resend.missingEmail');
    expect(mockSendVerificationEmail).not.toHaveBeenCalled();
  });
});
