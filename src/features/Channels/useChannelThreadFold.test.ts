import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { useChannelThreadFold } from './useChannelThreadFold';

const { channelState, globalStore } = vi.hoisted(() => ({
  channelState: { detailMap: {} as Record<string, any> },
  globalStore: { current: null as any },
}));

vi.mock('@/store/channel', () => ({
  channelSelectors: {
    detail:
      ({ channelId }: { channelId: string }) =>
      (s: typeof channelState) =>
        s.detailMap[channelId],
  },
  useChannelStore: (selector: (s: typeof channelState) => unknown) => selector(channelState),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) => globalStore.current(selector),
}));

const thread = (id: string, status = 'active') => ({ id, rootMessageId: `msg_${id}`, status });

beforeEach(() => {
  channelState.detailMap = {
    chn_dev: { messages: [], threads: [thread('thd_1'), thread('thd_old', 'archived')] },
  };
  globalStore.current = create<any>((set) => ({
    status: {},
    updateSystemStatus: (patch: Record<string, any>) =>
      set((s: any) => ({
        status: {
          ...s.status,
          channelThreadsCollapsed: {
            ...s.status.channelThreadsCollapsed,
            ...patch.channelThreadsCollapsed,
          },
        },
      })),
  }));
});

describe('useChannelThreadFold', () => {
  it('folds the open Channel’s threads and unfolds them again', () => {
    const { result } = renderHook(() => useChannelThreadFold('chn_dev', true, null));
    expect(result.current.expanded).toBe(true);
    expect(result.current.shown.map(({ thread }) => thread.id)).toEqual(['thd_1']);

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(globalStore.current.getState().status.channelThreadsCollapsed).toEqual({
      chn_dev: true,
    });

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
  });

  it('cannot fold a Channel that lists no threads or is not open', () => {
    channelState.detailMap.chn_dev.threads = [thread('thd_old', 'archived')];
    expect(
      renderHook(() => useChannelThreadFold('chn_dev', true, null)).result.current,
    ).toMatchObject({ expanded: false, foldable: false });

    channelState.detailMap.chn_dev.threads = [thread('thd_1')];
    expect(
      renderHook(() => useChannelThreadFold('chn_dev', false, 'thd_1')).result.current.foldable,
    ).toBe(false);
  });

  it('marks a folded Channel current while one of its threads is open', () => {
    const { result } = renderHook(() => useChannelThreadFold('chn_dev', true, 'thd_1'));
    expect(result.current.current).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.current).toBe(true);
  });

  // Opening a thread link before the Channel view loads must not flash the Channel as current.
  it('keeps the Channel not current while its view is still loading', () => {
    channelState.detailMap = {};
    const { result } = renderHook(() => useChannelThreadFold('chn_dev', true, 'thd_1'));
    expect(result.current.current).toBe(false);
  });
});
