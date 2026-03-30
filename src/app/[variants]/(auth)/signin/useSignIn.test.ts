import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── import under test ──────────────────────────────────────────
import { useSignIn } from './useSignIn';

// ── hoisted mocks ──────────────────────────────────────────────
const mockPush = vi.hoisted(() => vi.fn());
const mockSearchParamsGet = vi.hoisted(() => vi.fn().mockReturnValue(null));
const mockMessageError = vi.hoisted(() => vi.fn());
const mockMessageSuccess = vi.hoisted(() => vi.fn());
const mockSignInSocial = vi.hoisted(() => vi.fn());
const mockSignInOauth2 = vi.hoisted(() => vi.fn());
const mockSignInEmail = vi.hoisted(() => vi.fn());
const mockSignInMagicLink = vi.hoisted(() => vi.fn());
const mockRequestPasswordReset = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: { error: mockMessageError, success: mockMessageSuccess },
}));

vi.mock('@/libs/better-auth/auth-client', () => ({
  requestPasswordReset: mockRequestPasswordReset,
  signIn: {
    email: mockSignInEmail,
    magicLink: mockSignInMagicLink,
    oauth2: mockSignInOauth2,
    social: mockSignInSocial,
  },
}));

vi.mock('@/libs/better-auth/utils/client', () => ({
  isBuiltinProvider: (p: string) => ['google', 'github', 'apple'].includes(p),
  normalizeProviderId: (p: string) => p,
}));

vi.mock('@lobechat/business-const', () => ({
  BRANDING_NAME: 'LobeHub',
  ENABLE_BUSINESS_FEATURES: false,
}));

vi.mock('@/business/client/hooks/useBusinessSignin', () => ({
  useBusinessSignin: () => ({
    businessElement: null,
    getAdditionalData: async () => ({}),
    getFetchOptions: async () => undefined,
    preSocialSigninCheck: async () => true,
    ssoProviders: [],
  }),
}));

vi.mock('../_layout/AuthServerConfigProvider', () => ({
  useAuthServerConfigStore: (selector: (s: any) => any) =>
    selector({
      serverConfig: {
        disableEmailPassword: false,
        enableMagicLink: false,
        oAuthSSOProviders: ['google', 'github'],
      },
      serverConfigInit: true,
    }),
}));

// Mock antd Form.useForm
const mockSetFieldValue = vi.fn();
const mockGetFieldValue = vi.fn();
const mockValidateFields = vi.fn();
const mockSubmit = vi.fn();
vi.mock('antd', async () => {
  const actual: any = await vi.importActual('antd');
  return {
    ...actual,
    Form: {
      ...actual.Form,
      useForm: () => [
        {
          getFieldValue: mockGetFieldValue,
          setFieldValue: mockSetFieldValue,
          submit: mockSubmit,
          validateFields: mockValidateFields,
        },
      ],
    },
  };
});

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('useSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should return initial values', () => {
      const { result } = renderHook(() => useSignIn());

      expect(result.current.step).toBe('email');
      expect(result.current.email).toBe('');
      expect(result.current.loading).toBe(false);
      expect(result.current.socialLoading).toBeNull();
      expect(result.current.isSocialOnly).toBe(false);
      expect(result.current.disableEmailPassword).toBe(false);
    });
  });

  describe('handleCheckUser', () => {
    it('should redirect to signup when user does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: false }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'new@example.com' });
      });

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/signup?email=new%40example.com'),
      );
    });

    it('should go to password step when user exists with password', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      expect(result.current.step).toBe('password');
      expect(result.current.email).toBe('user@example.com');
    });

    it('should resolve username to email before checking', async () => {
      // First call: resolve-username
      mockFetch
        .mockResolvedValueOnce({
          json: async () => ({ email: 'resolved@example.com', exists: true }),
          ok: true,
        })
        // Second call: check-user
        .mockResolvedValueOnce({
          json: async () => ({ exists: true, hasPassword: true }),
          ok: true,
        });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'myusername' });
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/resolve-username', expect.any(Object));
      expect(result.current.step).toBe('password');
      expect(result.current.email).toBe('resolved@example.com');
    });

    it('should show error for unregistered username', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: false }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'unknownuser' });
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(result.current.step).toBe('email');
    });

    it('should show error for invalid identifier', async () => {
      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'invalid email!@#' });
      });

      expect(mockMessageError).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('handleSignIn', () => {
    it('should call signIn.email and redirect on success', async () => {
      mockSignInEmail.mockImplementation(async (_data: any, opts: any) => {
        opts.onSuccess();
        return { error: null };
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      // Set email first via handleCheckUser
      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleSignIn({ password: 'password123' });
      });

      expect(mockSignInEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          password: 'password123',
        }),
        expect.any(Object),
      );
      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('should show error on sign in failure', async () => {
      mockSignInEmail.mockResolvedValue({
        error: { message: 'Invalid credentials', status: 401 },
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleSignIn({ password: 'wrong' });
      });

      expect(mockMessageError).toHaveBeenCalledWith('Invalid credentials');
    });

    it('should redirect to verify-email on 403', async () => {
      mockSignInEmail.mockImplementation(async (_data: any, opts: any) => {
        opts.onError({ error: { status: 403 } });
        return { error: { message: 'Email not verified', status: 403 } };
      });

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleSignIn({ password: 'password' });
      });

      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining('/verify-email?email=user%40example.com'),
      );
    });
  });

  describe('handleSocialSignIn', () => {
    it('should call signIn.social for builtin providers', async () => {
      mockSignInSocial.mockResolvedValue({ url: 'https://google.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockSignInSocial).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'google' }),
      );
      expect(mockMessageError).not.toHaveBeenCalled();
    });

    it('should call signIn.oauth2 for custom providers', async () => {
      mockSignInOauth2.mockResolvedValue({ url: 'https://custom.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('custom-oidc');
      });

      expect(mockSignInOauth2).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'custom-oidc' }),
      );
    });

    it('should NOT throw when result has error: null (redirect case)', async () => {
      mockSignInSocial.mockResolvedValue({
        error: null,
        redirect: true,
        url: 'https://google.com/auth',
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      // Should not show error toast — this is the critical regression test
      expect(mockMessageError).not.toHaveBeenCalled();
    });

    it('should show error when result has a real error', async () => {
      mockSignInSocial.mockResolvedValue({
        error: { message: 'OAuth failed', status: 500 },
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(mockMessageError).toHaveBeenCalled();
    });

    it('should save last auth provider to localStorage', async () => {
      mockSignInSocial.mockResolvedValue({ url: 'https://google.com/auth' });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleSocialSignIn('google');
      });

      expect(localStorage.getItem('lobehub:auth:last-provider:v1')).toBe('google');
    });
  });

  describe('handleBackToEmail', () => {
    it('should reset to email step', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      expect(result.current.step).toBe('password');

      act(() => {
        result.current.handleBackToEmail();
      });

      expect(result.current.step).toBe('email');
      expect(result.current.email).toBe('');
      expect(result.current.isSocialOnly).toBe(false);
    });
  });

  describe('handleForgotPassword', () => {
    it('should call requestPasswordReset and show success', async () => {
      mockRequestPasswordReset.mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ exists: true, hasPassword: true }),
        ok: true,
      });

      const { result } = renderHook(() => useSignIn());

      // Set email first
      await act(async () => {
        await result.current.handleCheckUser({ email: 'user@example.com' });
      });

      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockRequestPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'user@example.com' }),
      );
      expect(mockMessageSuccess).toHaveBeenCalled();
    });

    it('should show error on failure', async () => {
      mockRequestPasswordReset.mockRejectedValue(new Error('fail'));

      const { result } = renderHook(() => useSignIn());

      await act(async () => {
        await result.current.handleForgotPassword();
      });

      expect(mockMessageError).toHaveBeenCalled();
    });
  });

  describe('provider sorting', () => {
    it('should sort last used provider first', () => {
      localStorage.setItem('lobehub:auth:last-provider:v1', 'github');

      const { result } = renderHook(() => useSignIn());

      expect(result.current.oAuthSSOProviders[0]).toBe('github');

      localStorage.removeItem('lobehub:auth:last-provider:v1');
    });
  });
});
