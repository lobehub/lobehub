import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock('@/libs/better-auth/auth-client', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  phoneNumber: {
    sendOtp: vi.fn(),
    verify: vi.fn(),
  },
  useSession: () => ({
    data: null,
    refetch: vi.fn(),
  }),
}));

describe('exitVerifyPhoneFlow', () => {
  const assign = vi.fn();

  beforeEach(() => {
    assign.mockReset();
    vi.stubGlobal('location', { assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns to callbackUrl instead of sign-in (logged-in trial verify)', async () => {
    const { exitVerifyPhoneFlow } = await import('./useVerifyPhone');
    exitVerifyPhoneFlow('/settings/profile');

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/settings/profile');
    expect(assign.mock.calls[0][0]).not.toContain('signin');
  });

  it('falls back to home for unsafe callback URLs', async () => {
    const { exitVerifyPhoneFlow } = await import('./useVerifyPhone');
    exitVerifyPhoneFlow('https://evil.example');

    expect(assign).toHaveBeenCalledWith('/');
  });
});

describe('refreshSessionAfterPhoneVerify', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
  });

  it('forces a DB-backed get-session so cookie cache picks up phoneNumberVerified', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        user: { phoneNumber: '+989121234567', phoneNumberVerified: true },
      },
      error: null,
    });

    const { refreshSessionAfterPhoneVerify } = await import('./useVerifyPhone');
    const user = await refreshSessionAfterPhoneVerify();

    expect(mockGetSession).toHaveBeenCalledWith({
      query: { disableCookieCache: true },
    });
    expect(user).toEqual({
      phoneNumber: '+989121234567',
      phoneNumberVerified: true,
    });
  });

  it('returns null when session is missing', async () => {
    mockGetSession.mockResolvedValue({ data: null, error: null });

    const { refreshSessionAfterPhoneVerify } = await import('./useVerifyPhone');
    await expect(refreshSessionAfterPhoneVerify()).resolves.toBeNull();
  });
});
