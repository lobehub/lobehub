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

describe('useMenu', () => {
  it('should provide correct menu items when user is logged in with auth', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

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

  it('should provide correct menu items when user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });

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
