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

const mockBetterAuthClient = vi.hoisted(() => ({
  listAccounts: vi.fn().mockResolvedValue({ data: [] }),
  accountInfo: vi.fn().mockResolvedValue({ data: { user: {} } }),
  signOut: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/libs/better-auth/auth-client', () => mockBetterAuthClient);

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();

  // Reset store state
  useUserStore.setState({
    isLoadedAuthProviders: false,
    authProviders: [],
    hasPasswordAccount: false,
  });
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
    it('should call better-auth signOut', async () => {
      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(mockBetterAuthClient.signOut).toHaveBeenCalled();
    });
  });

  describe('openLogin', () => {
    it('should redirect to signin page', async () => {
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

    it('should not redirect when already on signin page', async () => {
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...originalLocation,
          href: '',
          pathname: '/signin',
          toString: () => 'http://localhost/signin',
        },
        writable: true,
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.openLogin();
      });

      expect(window.location.href).toBe('');

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

      expect(mockBetterAuthClient.listAccounts).not.toHaveBeenCalled();
    });

    it('should fetch providers from BetterAuth', async () => {
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
      mockBetterAuthClient.listAccounts.mockRejectedValueOnce(new Error('Network error'));

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
    it('should refresh providers from BetterAuth', async () => {
      mockBetterAuthClient.listAccounts.mockResolvedValueOnce({
        data: [{ providerId: 'google', accountId: 'g-1' }],
      });
      mockBetterAuthClient.accountInfo.mockResolvedValueOnce({
        data: { user: { email: 'user@gmail.com' } },
      });

      const { result } = renderHook(() => useUserStore());

      await act(async () => {
        await result.current.refreshAuthProviders();
      });

      expect(mockBetterAuthClient.listAccounts).toHaveBeenCalled();
      expect(result.current.authProviders).toEqual([
        { provider: 'google', email: 'user@gmail.com', providerAccountId: 'g-1' },
      ]);
    });

    it('should handle refresh error gracefully', async () => {
      mockBetterAuthClient.listAccounts.mockRejectedValueOnce(new Error('Refresh failed'));

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
