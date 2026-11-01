import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLocalStorageState } from './useLocalStorageState';

const STORAGE_KEY = 'test-collapsed-preference';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useLocalStorageState', () => {
  it('uses the expanded default when no preference has been stored', () => {
    const { result } = renderHook(() => useLocalStorageState(STORAGE_KEY, false));

    expect(result.current[0]).toBe(false);
  });

  it('restores and updates a persisted collapsed preference', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(true));
    const { result } = renderHook(() => useLocalStorageState(STORAGE_KEY, false));

    await waitFor(() => expect(result.current[0]).toBe(true));

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(false));
  });
});
