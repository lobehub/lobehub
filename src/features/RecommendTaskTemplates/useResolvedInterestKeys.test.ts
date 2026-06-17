import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useUserStore } from '@/store/user';
import type { LobeUser } from '@/types/user';

import { useResolvedInterestKeys } from './useResolvedInterestKeys';

vi.mock('zustand/traditional');

describe('useResolvedInterestKeys', () => {
  it('returns null before auth loads', () => {
    const { result } = renderHook(() => useResolvedInterestKeys());

    expect(result.current).toBeNull();
  });

  it('waits for login user state before exposing empty interests', () => {
    act(() => {
      useUserStore.setState({
        isLoaded: true,
        isSignedIn: true,
        isUserStateInit: false,
        user: { id: 'user-id' } as LobeUser,
      });
    });

    const { result } = renderHook(() => useResolvedInterestKeys());

    expect(result.current).toBeNull();
  });

  it('normalizes interests after login user state initializes', () => {
    act(() => {
      useUserStore.setState({
        isLoaded: true,
        isSignedIn: true,
        isUserStateInit: true,
        user: { id: 'user-id', interests: [' AI ', '', 'Research'] } as LobeUser,
      });
    });

    const { result } = renderHook(() => useResolvedInterestKeys());

    expect(result.current).toEqual(['ai', 'research']);
  });

  it('allows empty interests after login user state initializes', () => {
    act(() => {
      useUserStore.setState({
        isLoaded: true,
        isSignedIn: true,
        isUserStateInit: true,
        user: { id: 'user-id', interests: [] } as LobeUser,
      });
    });

    const { result } = renderHook(() => useResolvedInterestKeys());

    expect(result.current).toEqual([]);
  });
});
