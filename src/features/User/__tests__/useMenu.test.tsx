import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import { useUserStore } from '@/store/user';

import { useMenu } from '../UserPanel/useMenu';

const wrapper: React.JSXElementConstructor<{ children: React.ReactNode }> = ({ children }) => (
  <ServerConfigStoreProvider>{children}</ServerConfigStoreProvider>
);

// Mock dependencies
vi.mock('next/link', () => ({
  default: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: vi.fn(() => ({
    push: vi.fn(),
  })),
}));

vi.mock('@/hooks/useInterceptingRoutes', () => ({
  useOpenSettings: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/DataImporter', () => ({
  default: vi.fn(({ children }) => <div>{children}</div>),
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key) => key),
  })),
}));

vi.mock('@/services/config', () => ({
  configService: {
    exportAgents: vi.fn(),
    exportAll: vi.fn(),
    exportSessions: vi.fn(),
    exportSettings: vi.fn(),
  },
}));

vi.mock('./useNewVersion', () => ({
  useNewVersion: vi.fn(() => false),
}));

// Use vi.hoisted to ensure variables exist before vi.mock factory executes
const { enableAuth, enableClerk } = vi.hoisted(() => ({
  enableAuth: { value: true },
  enableClerk: { value: true },
}));

vi.mock('@/envs/auth', () => ({
  get enableAuth() {
    return enableAuth.value;
  },
  get enableClerk() {
    return enableClerk.value;
  },
}));

afterEach(() => {
  enableAuth.value = true;
  enableClerk.value = true;
});

describe('useMenu', () => {
  it('should provide correct menu items when user is logged in with auth', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true, enableAuth: () => true });
    });
    enableAuth.value = true;
    enableClerk.value = false;

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // 'setting' and 'import' are shown when logged in
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(true);
      expect(mainItems?.some((item) => item?.key === 'import')).toBe(true);
      // 'logout' is shown when isLoginWithAuth is true
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(true);
    });
  });

  it('should provide correct menu items when user is logged in without auth', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false, enableAuth: () => false });
    });
    enableAuth.value = false;

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // When not logged in (isLogin = false), these items should not be shown
      // isLogin checks isSignedIn, so with isSignedIn: false, isLogin should be false
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(false);
      expect(mainItems?.some((item) => item?.key === 'import')).toBe(false);
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(false);
    });
  });

  it('should provide correct menu items when user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false, enableAuth: () => true });
    });
    enableAuth.value = true;

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems, logoutItems } = result.current;
      // When not logged in, setting and import should not be shown
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(false);
      expect(mainItems?.some((item) => item?.key === 'import')).toBe(false);
      expect(logoutItems.some((item) => item?.key === 'logout')).toBe(false);
    });
  });
});
