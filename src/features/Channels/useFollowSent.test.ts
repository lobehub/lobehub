import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFollowSent } from './useFollowSent';

vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: '/agent/ch-1', search: '' }),
}));
vi.mock('@/libs/replica', () => ({
  cacheScope: { get: () => 'scope-1', use: () => 'scope-1' },
}));

/** A reply to an Agent is stored in a thread, so the send resolves to the thread it went to. */
const storedIn = (threadId: string) => Promise.resolve({ threadId });

describe('useFollowSent', () => {
  afterEach(() => cleanup());

  it('opens the thread a reply was stored in', async () => {
    const open = vi.fn();
    const { result } = renderHook(() => useFollowSent(null, open));

    await act(async () => {
      result.current(storedIn('thread-1'));
    });

    expect(open).toHaveBeenCalledWith('thread-1', false);
  });

  it('stays where the user is while the Channel is covered by a thread page', async () => {
    const open = vi.fn();
    const { result } = renderHook(() => useFollowSent(null, open, true));

    await act(async () => {
      result.current(storedIn('thread-1'));
    });

    expect(open).not.toHaveBeenCalled();
  });

  it('leaves the thread already being read in place', async () => {
    const open = vi.fn();
    const { result } = renderHook(() => useFollowSent('thread-9', open));

    await act(async () => {
      result.current(storedIn('thread-1'));
    });

    expect(open).not.toHaveBeenCalled();
  });
});
