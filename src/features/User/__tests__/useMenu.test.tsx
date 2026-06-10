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

describe('useMenu', () => {
  it('should keep workspace-aware Settings and drop Account-Panel-only items', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems } = result.current;
      // Settings stays in the Workspace Panel so workspace-context Settings
      // is reachable in one click.
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(true);
      // Account-only items have moved to the Account Panel and must not
      // appear in the Workspace Panel menu.
      expect(mainItems?.some((item) => item?.key === 'get-desktop-app')).toBe(false);
      expect(mainItems?.some((item) => item?.key === 'logout')).toBe(false);
    });
  });

  it('should hide Settings when not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems } = result.current;
      expect(mainItems?.some((item) => item?.key === 'setting')).toBe(false);
    });
  });

  it('should not have consecutive dividers in mainItems', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });

    const { result } = renderHook(() => useMenu(), { wrapper });

    act(() => {
      const { mainItems } = result.current;
      if (!mainItems) return;

      for (let i = 1; i < mainItems.length; i++) {
        const prev = mainItems[i - 1];
        const curr = mainItems[i];
        const isDivider = (item: any) =>
          item && typeof item === 'object' && item.type === 'divider';
        expect(isDivider(prev) && isDivider(curr)).toBe(false);
      }
    });
  });
});
