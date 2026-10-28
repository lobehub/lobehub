import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspacePreferenceReady } from './useWorkspacePreferenceReady';

const mocks = vi.hoisted(() => ({
  isLoading: false,
  useFetchWorkspaceUserPreference: vi.fn(),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) =>
    selector({ useFetchWorkspaceUserPreference: mocks.useFetchWorkspaceUserPreference }),
}));

describe('useWorkspacePreferenceReady', () => {
  beforeEach(() => {
    mocks.isLoading = false;
    mocks.useFetchWorkspaceUserPreference.mockReset();
    mocks.useFetchWorkspaceUserPreference.mockImplementation(() => ({
      isLoading: mocks.isLoading,
    }));
  });

  /** @example A cold project route has no other surface syncing the preference. */
  it('syncs the preference itself and is not ready while it loads', () => {
    mocks.isLoading = true;

    const { result } = renderHook(() => useWorkspacePreferenceReady());

    expect(mocks.useFetchWorkspaceUserPreference).toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it('is ready once the preference is known', () => {
    const { result } = renderHook(() => useWorkspacePreferenceReady());

    expect(result.current).toBe(true);
  });
});
