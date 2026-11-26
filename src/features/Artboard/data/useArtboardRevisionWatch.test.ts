import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import type { Operation } from '@/store/chat/slices/operation/types';

import { useArtboardRevisionWatch } from './useArtboardRevisionWatch';

const { checkArtboardRevision } = vi.hoisted(() => ({
  checkArtboardRevision: vi.fn(async () => {}),
}));
vi.mock('./revisionWatch', () => ({ checkArtboardRevision }));

const artboard = {
  id: 'art_1',
  revision: 3,
  topicId: 'tpc_1',
  updatedAt: new Date('2026-11-18T10:00:00Z'),
};

const run = (status: Operation['status']) =>
  act(() => {
    useChatStore.setState({
      operations: {
        op_1: {
          context: { topicId: 'tpc_1' },
          id: 'op_1',
          metadata: {},
          status,
          type: 'execHeterogeneousAgent',
        } as unknown as Operation,
      },
    });
  });

describe('useArtboardRevisionWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => useChatStore.setState({ operations: {} }));
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('polls every 2 s while an agent runs in the topic and stops when the run ends', async () => {
    run('running');
    renderHook(() => useArtboardRevisionWatch(artboard));

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(checkArtboardRevision).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(checkArtboardRevision).toHaveBeenCalledTimes(3);

    run('success');
    // The run-end check fires once; no more polling after it.
    expect(checkArtboardRevision).toHaveBeenCalledTimes(4);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(checkArtboardRevision).toHaveBeenCalledTimes(4);
  });

  it('stops polling when the board closes', async () => {
    run('running');
    const { unmount } = renderHook(() => useArtboardRevisionWatch(artboard));

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(checkArtboardRevision).toHaveBeenCalledTimes(1);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(checkArtboardRevision).toHaveBeenCalledTimes(1);
  });

  it('does not poll while no agent runs in the topic', async () => {
    renderHook(() => useArtboardRevisionWatch(artboard));

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(checkArtboardRevision).not.toHaveBeenCalled();
  });
});
