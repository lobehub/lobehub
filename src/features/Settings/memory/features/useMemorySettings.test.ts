import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';

import { useMemorySettings } from './useMemorySettings';

const initialUserStoreState = useUserStore.getState();

afterEach(() => {
  cleanup();
  useUserStore.setState(initialUserStoreState, true);
});

describe('useMemorySettings', () => {
  it('defaults to enabled when no user override exists', () => {
    useUserStore.setState({ isUserStateInit: true, settings: {} });

    const { result } = renderHook(() =>
      useMemorySettings({ canManageMemory: true, save: vi.fn() }),
    );

    expect(result.current.enabled).toBe(true);
    expect(result.current.effort).toBe('medium');
  });

  it('returns the persisted state and saves both switch values', async () => {
    const setSettings = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn(async (task: () => Promise<void>) => task());
    useUserStore.setState({
      isUserStateInit: true,
      setSettings,
      settings: { memory: { effort: 'low', enabled: false } },
    });

    const { result } = renderHook(() => useMemorySettings({ canManageMemory: true, save }));

    expect(result.current.enabled).toBe(false);
    expect(result.current.effort).toBe('low');

    await act(() => result.current.setEnabled(true));
    expect(setSettings).toHaveBeenLastCalledWith({ memory: { enabled: true } });

    act(() => useUserStore.setState({ settings: { memory: { enabled: true } } }));
    expect(result.current.enabled).toBe(true);

    await act(() => result.current.setEnabled(false));
    expect(setSettings).toHaveBeenLastCalledWith({ memory: { enabled: false } });

    await act(() => result.current.setEffort('high'));
    expect(setSettings).toHaveBeenLastCalledWith({ memory: { effort: 'high' } });
  });
});
