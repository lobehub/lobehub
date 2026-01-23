import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { useUserStore } from '@/store/user';

vi.mock('zustand/traditional');

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Use vi.hoisted to ensure variables exist before vi.mock factory executes
const { enableNextAuth, enableBetterAuth } = vi.hoisted(() => ({
  enableNextAuth: { value: false },
  enableBetterAuth: { value: false },
}));

vi.mock('@/envs/auth', () => ({
  get enableNextAuth() {
    return enableNextAuth.value;
  },
  get enableBetterAuth() {
    return enableBetterAuth.value;
  },
}));

const mockUserService = vi.hoisted(() => ({
  getUserSSOProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/user', () => ({
  userService: mockUserService,
}));

const mockBetterAuthClient = vi.hoisted(() => ({
  listAccounts: vi.fn().mockResolvedValue({ data: [] }),
  accountInfo: vi.fn().mockResolvedValue({ data: { user: {} } }),
  signOut: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/libs/better-auth/auth-client', () => mockBetterAuthClient);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();

  enableNextAuth.value = false;
  enableBetterAuth.value = false;

  // Reset store state
  useUserStore.setState({
    isLoadedAuthProviders: false,
    authProviders: [],
    hasPasswordAccount: false,
  });
});

/**
 * Mock nextauth 库相关方法
 */
vi.mock('next-auth/react', async () => {
  return {
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
});

describe('createAuthSlice', () => {
  describe('refreshUserState', () => {
    it('should refresh user config', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshUserState();
      });

      expect(mutate).toHaveBeenCalledWith('initUserState');
    });
  });

  describe('logout', () => {
    it('should call next-auth signOut when NextAuth is enabled', async () => {
      enableNextAuth.value = true;

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      const { signOut } = await import('next-auth/react');

      expect(signOut).toHaveBeenCalled();
      enableNextAuth.value = false;
    });

    it('should not call next-auth signOut when NextAuth is disabled', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      const { signOut } = await import('next-auth/react');

      expect(signOut).not.toHaveBeenCalled();
    });
  });

  describe('openLogin', () => {
    it('should call next-auth signIn when NextAuth is enabled', async () => {
      enableNextAuth.value = true;

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      const { signIn } = await import('next-auth/react');

      expect(signIn).toHaveBeenCalled();
      enableNextAuth.value = false;
    });
    it('should not call next-auth signIn when NextAuth is disabled', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      const { signIn } = await import('next-auth/react');

      expect(signIn).not.toHaveBeenCalled();
    });

    it('should redirect to signin page when BetterAuth is enabled', async () => {
      enableBetterAuth.value = true;

      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          href: '',
          pathname: '/chat',
          toString: () => 'http://localhost/chat',
        },
        writable: true,
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      expect(window.location.href).toContain('/signin');
      expect(window.location.href).toContain('callbackUrl');

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
    });

    it('should call signIn with single provider when only one OAuth provider available', async () => {
      enableNextAuth.value = true;
      useUserStore.setState({ oAuthSSOProviders: ['github'] });

      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          href: '',
          pathname: '/chat',
          toString: () => 'http://localhost/chat',
        },
        writable: true,
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      const { signIn } = await import('next-auth/react');

      expect(signIn).toHaveBeenCalledWith('github');

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true,
      });
    });
  });

  describe('fetchAuthProviders', () => {
    it('should skip fetching if already loaded', async () => {
      useUserStore.setState({ isLoadedAuthProviders: true });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(mockUserService.getUserSSOProviders).not.toHaveBeenCalled();
    });

    it('should fetch providers from NextAuth when BetterAuth is disabled', async () => {
      enableBetterAuth.value = false;
      const mockProviders = [
        { provider: 'github', email: 'test@example.com', providerAccountId: '123' },
      ];
      mockUserService.getUserSSOProviders.mockResolvedValueOnce(mockProviders);

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(mockUserService.getUserSSOProviders).toHaveBeenCalled();
      expect(result.current.isLoadedAuthProviders).toBe(true);
      expect(result.current.authProviders).toEqual(mockProviders);
    });

    it('should fetch providers from BetterAuth when enabled', async () => {
      enableBetterAuth.value = true;
      mockBetterAuthClient.listAccounts.mockResolvedValueOnce({
        data: [
          { providerId: 'github', accountId: 'gh-123' },
          { providerId: 'credential', accountId: 'cred-1' },
        ],
      });
      mockBetterAuthClient.accountInfo.mockResolvedValueOnce({
        data: { user: { email: 'test@github.com' } },
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(mockBetterAuthClient.listAccounts).toHaveBeenCalled();
      expect(result.current.isLoadedAuthProviders).toBe(true);
      expect(result.current.hasPasswordAccount).toBe(true);
    });

    it('should handle fetch error gracefully', async () => {
      enableBetterAuth.value = false;
      mockUserService.getUserSSOProviders.mockRejectedValueOnce(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.fetchAuthProviders();
      });

      expect(result.current.isLoadedAuthProviders).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('refreshAuthProviders', () => {
    it('should refresh providers from NextAuth', async () => {
      enableBetterAuth.value = false;
      const mockProviders = [
        { provider: 'google', email: 'user@gmail.com', providerAccountId: 'g-1' },
      ];
      mockUserService.getUserSSOProviders.mockResolvedValueOnce(mockProviders);

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshAuthProviders();
      });

      expect(mockUserService.getUserSSOProviders).toHaveBeenCalled();
      expect(result.current.authProviders).toEqual(mockProviders);
    });

    it('should handle refresh error gracefully', async () => {
      enableBetterAuth.value = false;
      mockUserService.getUserSSOProviders.mockRejectedValueOnce(new Error('Refresh failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshAuthProviders();
      });

      // Should not throw
      consoleSpy.mockRestore();
    });
  });
});
