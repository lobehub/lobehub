/**
 * @vitest-environment happy-dom
 *
 * The unresolved brief feed is a replica: the inbox paints the persisted rows
 * on the first frame, a mutation shows at once and rolls back when the server
 * rejects, and the view is cleared when the identity scope changes.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { briefService } from '@/services/brief';
import { useBriefStore } from '@/store/brief';
import type { BriefItem } from '@/store/brief/types';

import { initialBriefListState } from './initialState';
import { briefListResource } from './projection';
import { briefListSelectors } from './selectors';

const LIST_PARAMS = {} as Record<string, never>;
/** The persisted row of the feed under test (one entry, keyed `unresolved`). */
const STORAGE_KEY = { queryKey: briefListResource.storageKey(LIST_PARAMS) };

const createBrief = (id: string): BriefItem => ({
  actions: null,
  agent: null,
  agentId: null,
  artifacts: null,
  createdAt: '2026-07-31T00:00:00.000Z',
  cronJobId: null,
  id,
  priority: null,
  readAt: null,
  resolvedAction: null,
  resolvedAt: null,
  resolvedComment: null,
  summary: `${id} summary`,
  taskId: null,
  title: `${id} title`,
  topicId: null,
  type: 'result',
  userId: 'user-1',
});

const deferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
};

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

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

/** The feed as the inbox reads it. */
const feed = () => briefListSelectors.briefs(useBriefStore.getState());

/** Drive the real sync path and wait until the head page has landed. */
const load = async (briefs: BriefItem[]) => {
  vi.spyOn(briefService, 'listUnresolved').mockResolvedValue({ data: briefs } as never);
  renderHook(() => useBriefStore((s) => s.useFetchBriefs)(true), { wrapper });
  await waitFor(() => expect(feed()).toBeDefined());
  return briefs;
};

beforeEach(() => {
  useScope(`brief-user-${randomUUID()}:personal`);
  act(() => useBriefStore.setState({ ...initialBriefListState }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('brief list replica', () => {
  it('paints the persisted feed before the network answers', async () => {
    await briefListResource.storage!.set(
      { ...STORAGE_KEY, scope },
      { data: [createBrief('cached')], updatedAt: 1 },
    );
    vi.spyOn(briefService, 'listUnresolved').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useBriefStore((s) => s.useFetchBriefs)(true), { wrapper });

    await waitFor(() => expect(feed().map((brief) => brief.id)).toEqual(['cached']));
    expect(briefListSelectors.isBriefsInit(useBriefStore.getState())).toBe(true);
    expect(result.current.isValidating).toBe(true);
  });

  it('does not fetch while logged out', () => {
    const listUnresolved = vi.spyOn(briefService, 'listUnresolved');
    renderHook(() => useBriefStore((s) => s.useFetchBriefs)(false), { wrapper });
    expect(listUnresolved).not.toHaveBeenCalled();
  });

  it('marks a brief read optimistically and rolls back when the server rejects', async () => {
    await load([createBrief('b1')]);
    const request = deferred<void>();
    vi.spyOn(briefService, 'markRead').mockReturnValue(request.promise as never);

    const pending = useBriefStore.getState().markBriefRead('b1');
    expect(feed()[0].readAt).toBeTruthy();

    request.reject(new Error('failed'));
    await expect(pending).rejects.toThrow('failed');
    expect(feed()[0].readAt).toBeNull();
  });

  it('writes a confirmed resolve through to the persisted row', async () => {
    await load([createBrief('b1')]);
    vi.spyOn(briefService, 'resolve').mockResolvedValue(undefined as never);

    await act(() => useBriefStore.getState().resolveBrief('b1', 'approve'));

    expect(feed()[0]).toMatchObject({ resolvedAction: 'approve' });
    expect(feed()[0].resolvedAt).toBeTruthy();

    await waitFor(async () => {
      const row = await briefListResource.storage!.get({ ...STORAGE_KEY, scope });
      expect(row?.data[0]).toMatchObject({ resolvedAction: 'approve' });
    });
  });

  it('drops the briefs resolved as read from the feed', async () => {
    await load([createBrief('b1'), createBrief('b2')]);
    vi.spyOn(briefService, 'resolveManyAsRead').mockResolvedValue({ data: ['b1'] } as never);

    await act(() => useBriefStore.getState().resolveBriefsAsRead(['b1']));

    expect(feed().map((brief) => brief.id)).toEqual(['b2']);
  });

  it('removes a deleted brief and restores it when the server rejects', async () => {
    await load([createBrief('b1'), createBrief('b2')]);
    const request = deferred<void>();
    vi.spyOn(briefService, 'delete').mockReturnValue(request.promise as never);

    const pending = useBriefStore.getState().deleteBrief('b1');
    expect(feed().map((brief) => brief.id)).toEqual(['b2']);

    request.reject(new Error('failed'));
    await expect(pending).rejects.toThrow('failed');
    expect(feed().map((brief) => brief.id)).toEqual(['b1', 'b2']);
  });

  it('clears the previous scope’s feed on a scope switch, before any answer lands', async () => {
    vi.spyOn(briefService, 'listUnresolved').mockResolvedValue({
      data: [createBrief('b1'), createBrief('b2')],
    } as never);
    const { rerender } = renderHook(() => useBriefStore((s) => s.useFetchBriefs)(true), {
      wrapper,
    });
    await waitFor(() => expect(feed()).toBeDefined());
    expect(feed().length).toBeGreaterThan(0);

    // A different identity: the previous scope's rows are unreachable here, so
    // they must leave the view even while the new scope's fetch is in flight.
    useScope(`brief-user-${randomUUID()}:personal`);
    vi.spyOn(briefService, 'listUnresolved').mockImplementation(() => new Promise(() => {}));
    rerender();

    await waitFor(() => expect(briefListSelectors.hasBriefs(useBriefStore.getState())).toBe(false));
  });
});
