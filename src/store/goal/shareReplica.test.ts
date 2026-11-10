/**
 * @vitest-environment happy-dom
 *
 * The owner's share record of a goal is a replica: the popover paints the
 * persisted copy at once, a settled "not shared" is a value of its own, the
 * visibility toggle and "stop sharing" land immediately and roll back when the
 * server refuses, and enabling re-reads the record the server minted.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { type GoalShareInfo, goalShareService } from '@/services/goalShare';

import { goalSelectors, useGoalStore } from './index';
import { initialState } from './initialState';
import { goalShareResource } from './projection';

vi.mock('@/services/goalShare', () => ({
  goalShareService: {
    disable: vi.fn(),
    enable: vi.fn(),
    getInfo: vi.fn(),
    setVisibility: vi.fn(),
  },
}));

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

const record = (visibility: 'link' | 'private'): GoalShareInfo => ({
  goalId: 'goal-1',
  id: 'share-1',
  pageViewCount: 0,
  userId: 'user-1',
  visibility,
});

/** Never-resolving read: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const STORAGE_KEY = goalShareResource.storageKey('goal-1');
const share = () => goalSelectors.goalShare('goal-1')(useGoalStore.getState());

describe('goal share replica', () => {
  const scopes = new Set<string>();
  const scopeRef = { current: '' };

  beforeEach(() => {
    scopeRef.current = `goal-share-user-${randomUUID()}:personal`;
    scopes.add(scopeRef.current);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scopeRef.current);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scopeRef.current);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useGoalStore.setState(initialState));
  });

  afterEach(async () => {
    for (const scope of scopes) {
      await goalShareResource.storage!.remove({ queryKey: STORAGE_KEY, scope });
    }
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /** Mount the read and wait until the replica holds the record. */
  const mountWith = async (value: GoalShareInfo | null) => {
    vi.mocked(goalShareService.getInfo).mockResolvedValue(value);
    const sync = renderHook(() => useGoalStore((s) => s.useFetchGoalShare)('goal-1'), { wrapper });
    await waitFor(() => expect(share()).toEqual(value));
    return sync;
  };

  it('paints the persisted record before the network answers', async () => {
    await goalShareResource.storage!.set(
      { queryKey: STORAGE_KEY, scope: scopeRef.current },
      { data: { share: record('link') }, updatedAt: 1 },
    );
    vi.mocked(goalShareService.getInfo).mockImplementation(pending);

    const sync = renderHook(() => useGoalStore((s) => s.useFetchGoalShare)('goal-1'), { wrapper });

    await waitFor(() => expect(share()?.visibility).toBe('link'));
    expect(sync.result.current.isHydrated).toBe(true);
  });

  it('settles on "not shared" as null, distinct from "not read yet"', async () => {
    expect(share()).toBeUndefined();

    await mountWith(null);

    expect(share()).toBeNull();
  });

  it('does not read the share while it is disabled', () => {
    renderHook(() => useGoalStore((s) => s.useFetchGoalShare)('goal-1', false), { wrapper });

    expect(goalShareService.getInfo).not.toHaveBeenCalled();
    expect(share()).toBeUndefined();
  });

  it('enables, then keeps the record the server created', async () => {
    await mountWith(null);
    vi.mocked(goalShareService.enable).mockResolvedValue(record('link'));
    vi.mocked(goalShareService.getInfo).mockResolvedValue(record('link'));

    await act(() => useGoalStore.getState().enableGoalShare('goal-1', 'link'));

    expect(goalShareService.enable).toHaveBeenCalledWith('goal-1', 'link');
    expect(share()).toEqual(record('link'));
  });

  it('flips the visibility at once and keeps it once the server confirms', async () => {
    await mountWith(record('link'));
    let confirm!: () => void;
    vi.mocked(goalShareService.setVisibility).mockImplementation(
      () => new Promise((resolve) => (confirm = () => resolve(record('private')))),
    );

    let write!: Promise<void>;
    act(() => {
      write = useGoalStore.getState().setGoalShareVisibility('goal-1', 'private');
    });
    expect(share()?.visibility).toBe('private');

    await act(async () => {
      confirm();
      await write;
    });
    expect(share()?.visibility).toBe('private');
  });

  it('rolls the visibility back when the server refuses', async () => {
    await mountWith(record('link'));
    vi.mocked(goalShareService.setVisibility).mockRejectedValue(new Error('forbidden'));

    await act(async () => {
      await expect(
        useGoalStore.getState().setGoalShareVisibility('goal-1', 'private'),
      ).rejects.toThrow('forbidden');
    });

    expect(share()?.visibility).toBe('link');
  });

  it('settles on "not shared" once sharing is stopped', async () => {
    await mountWith(record('link'));
    vi.mocked(goalShareService.disable).mockResolvedValue(undefined);

    await act(() => useGoalStore.getState().disableGoalShare('goal-1'));

    expect(goalShareService.disable).toHaveBeenCalledWith('goal-1');
    expect(share()).toBeNull();
  });

  it('keeps the record when stopping is refused', async () => {
    await mountWith(record('link'));
    vi.mocked(goalShareService.disable).mockRejectedValue(new Error('forbidden'));

    await act(async () => {
      await expect(useGoalStore.getState().disableGoalShare('goal-1')).rejects.toThrow();
    });

    expect(share()?.visibility).toBe('link');
  });
});
