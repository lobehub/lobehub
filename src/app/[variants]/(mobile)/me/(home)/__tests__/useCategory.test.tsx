import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ServerConfigStoreProvider } from '@/store/serverConfig/Provider';
import { useUserStore } from '@/store/user';

import { useCategory } from '../features/useCategory';

const wrapper: React.JSXElementConstructor<{ children: React.ReactNode }> = ({ children }) => (
  <ServerConfigStoreProvider>{children}</ServerConfigStoreProvider>
);

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key) => key),
  })),
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

// Mock version constants
vi.mock('@/const/version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/const/version')>();
  return {
    ...actual,
    isServerMode: false,
  };
});

afterEach(() => {
  enableAuth.value = true;
  enableClerk.value = true;
  mockNavigate.mockReset();
});

describe('useCategory', () => {
  it('should return correct items when the user is logged in with authentication', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: true });
    });
    enableAuth.value = true;
    enableClerk.value = false;

    const mockOpenChangelogModal = vi.fn();
    const { result } = renderHook(() => useCategory(mockOpenChangelogModal), { wrapper });

    act(() => {
      const items = result.current;
      expect(items.some((item) => item.key === 'profile')).toBe(true);
      expect(items.some((item) => item.key === 'setting')).toBe(true);
      expect(items.some((item) => item.key === 'docs')).toBe(true);
      expect(items.some((item) => item.key === 'feedback')).toBe(true);
      expect(items.some((item) => item.key === 'changelog')).toBe(true);
    });
  });

  it('should return correct items when the user is not logged in', () => {
    act(() => {
      useUserStore.setState({ isSignedIn: false });
    });
    enableAuth.value = true;

    const mockOpenChangelogModal = vi.fn();
    const { result } = renderHook(() => useCategory(mockOpenChangelogModal), { wrapper });

    act(() => {
      const items = result.current;
      expect(items.some((item) => item.key === 'profile')).toBe(false);
      expect(items.some((item) => item.key === 'setting')).toBe(false);
      expect(items.some((item) => item.key === 'data')).toBe(false);
      expect(items.some((item) => item.key === 'docs')).toBe(true);
      expect(items.some((item) => item.key === 'feedback')).toBe(true);
      expect(items.some((item) => item.key === 'changelog')).toBe(true);
    });
  });
});
