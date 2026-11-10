/**
 * @vitest-environment happy-dom
 *
 * The topic memory bundles are a replica: `topicMemoriesMap` is its view and the
 * chat send path reads it synchronously (`resolveTopicMemories`), so a reload or
 * a topic revisit must paint the persisted bundle before the network only
 * confirms it. One entry per topic, partitioned by identity scope.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { REPLICA_INDEX_KEY } from 'local-replica';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type RetrieveMemoryResult } from '@/types/userMemory';

import { initialState as userMemoryInitialState } from '../../initialState';
import { useUserMemoryStore } from '../../store';
import { identityScopeOf, MAX_RECENT_TOPIC_MEMORIES } from '../../utils/replica';
import { topicMemoriesResource } from './projection';
import { agentMemorySelectors } from './selectors';

vi.mock('@/services/userMemory', () => ({
  memoryCRUDService: { deleteAll: vi.fn() },
  userMemoryService: { retrieveMemoryForTopic: vi.fn() },
}));

const TOPIC_A = 'topic-a';
const TOPIC_B = 'topic-b';

const bundle = (marker: string): RetrieveMemoryResult =>
  ({
    activities: [{ id: `${marker}-activity` }],
    contexts: [{ id: `${marker}-context` }],
    experiences: [{ id: `${marker}-experience` }],
    preferences: [{ id: `${marker}-preference` }],
  }) as unknown as RetrieveMemoryResult;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

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

const topicMemories = (topicId: string) =>
  agentMemorySelectors.topicMemories(topicId)(useUserMemoryStore.getState());
const entry = (topicId: string) =>
  useUserMemoryStore.getState().topicMemoriesReplica.entries[topicId];

describe('userMemory topic memories replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  /** The storage partition of the topic memories: the identity, not the workspace. */
  let rowScope = '';
  const useScope = (next: string) => {
    scope = next;
    rowScope = identityScopeOf(next);
    scopes.add(rowScope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`memory-user-${randomUUID()}:personal`);
    act(() =>
      useUserMemoryStore.setState({
        ...userMemoryInitialState,
        topicMemoriesMap: {},
        topicMemoriesReplica: createReplicaState(),
      }),
    );
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [TOPIC_A, TOPIC_B].map((topicId) =>
          topicMemoriesResource.storage!.remove({
            queryKey: topicMemoriesResource.storageKey(topicId),
            scope: value,
          }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted bundle before the network answers', async () => {
    const cached = bundle('cached');
    await topicMemoriesResource.storage!.set(
      { queryKey: topicMemoriesResource.storageKey(TOPIC_A), scope: rowScope },
      { data: cached, updatedAt: 1 },
    );
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockImplementation(pending);

    const sync = renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), {
      wrapper,
    });

    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(cached));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the persisted bundle with the network response and persists it', async () => {
    const fresh = bundle('fresh');
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(fresh);

    renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), { wrapper });

    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(fresh));
    // The view is backed by the replica engine, keyed by the topic.
    expect(entry(TOPIC_A)?.source).toBe('server');

    await waitFor(async () =>
      expect(
        (
          await topicMemoriesResource.storage!.get({
            queryKey: topicMemoriesResource.storageKey(TOPIC_A),
            scope: rowScope,
          })
        )?.data,
      ).toEqual(fresh),
    );
  });

  it('drops a topic’s bundle — view, bookkeeping and storage — on clear', async () => {
    const fresh = bundle('fresh');
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(fresh);

    renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), { wrapper });
    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(fresh));

    act(() => useUserMemoryStore.getState().clearTopicMemories(TOPIC_A));

    expect(topicMemories(TOPIC_A)).toBeUndefined();
    expect(entry(TOPIC_A)).toBeUndefined();
    expect(agentMemorySelectors.hasTopicMemories(TOPIC_A)(useUserMemoryStore.getState())).toBe(
      false,
    );

    await waitFor(async () =>
      expect(
        await topicMemoriesResource.storage!.get({
          queryKey: topicMemoriesResource.storageKey(TOPIC_A),
          scope: rowScope,
        }),
      ).toBeUndefined(),
    );
  });

  it('purges every persisted bundle on purgeAllMemories, so a reload cannot restore them', async () => {
    const storageKeyOf = (topicId: string) => ({
      queryKey: topicMemoriesResource.storageKey(topicId),
      scope: rowScope,
    });
    const resetMemory = () =>
      act(() =>
        useUserMemoryStore.setState({
          topicMemoriesMap: {},
          topicMemoriesReplica: createReplicaState(),
        }),
      );

    // An earlier session persisted TOPIC_B; after the reload it is not in memory.
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(
      bundle('earlier-session'),
    );
    const earlier = renderHook(
      () => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_B),
      { wrapper },
    );
    await waitFor(async () =>
      expect(await topicMemoriesResource.storage!.get(storageKeyOf(TOPIC_B))).toBeDefined(),
    );
    earlier.unmount();
    resetMemory();

    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(bundle('fresh'));
    renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), { wrapper });
    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(bundle('fresh')));
    await waitFor(async () =>
      expect(await topicMemoriesResource.storage!.get(storageKeyOf(TOPIC_A))).toBeDefined(),
    );

    // After the purge the server only has an empty bundle to give back.
    const empty = bundle('empty');
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(empty);
    await act(() => useUserMemoryStore.getState().purgeAllMemories());

    expect(memoryCRUDService.deleteAll).toHaveBeenCalledTimes(1);
    expect(await topicMemoriesResource.storage!.get(storageKeyOf(TOPIC_B))).toBeUndefined();
    // The mounted topic settles on the server's post-purge answer, which is all
    // that is persisted for it — never the deleted bundle.
    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(empty));
    await waitFor(async () =>
      expect((await topicMemoriesResource.storage!.get(storageKeyOf(TOPIC_A)))?.data).toEqual(
        empty,
      ),
    );

    // Reload: a fresh view whose fetch never answers paints nothing deleted.
    cleanup();
    resetMemory();
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockImplementation(pending);
    const reloaded = renderHook(
      () => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_B),
      { wrapper },
    );
    await waitFor(() => expect(reloaded.result.current.isHydrated).toBe(true));
    expect(topicMemories(TOPIC_B)).toBeUndefined();
  });

  it('retries a purge whose local deletes failed, so no earlier bundle survives', async () => {
    // `purgeAllMemories` revalidates through the app's scoped `mutate`.
    renderHook(() => null, { wrapper });

    const storage = topicMemoriesResource.storage!;
    const remove = storage.remove.bind(storage);
    const rowKey = { queryKey: topicMemoriesResource.storageKey(TOPIC_B), scope: rowScope };
    const indexRowKey = { queryKey: REPLICA_INDEX_KEY, scope: rowScope };

    // An earlier session's rows only — nothing is tracked in memory.
    await storage.set(rowKey, { data: bundle('earlier-session'), updatedAt: 1 });
    await storage.set(indexRowKey, { data: [rowKey.queryKey], updatedAt: 1 });

    // The first try aborts (a blocked IndexedDB upgrade); the retry lands.
    let removeCalls = 0;
    vi.spyOn(storage, 'remove').mockImplementation(async (key) => {
      if (++removeCalls === 1) throw new Error('IndexedDB transaction aborted');
      return remove(key);
    });

    await act(() => useUserMemoryStore.getState().purgeAllMemories());

    expect(removeCalls).toBeGreaterThan(1);
    expect(await storage.get(rowKey)).toBeUndefined();
  });

  it('purges the bundles cached in the identity’s other workspaces', async () => {
    const userId = scope.slice(0, scope.indexOf(':'));
    const otherWorkspace = `${userId}:workspace-b`;
    const personal = scope;

    // A bundle fetched and persisted while the user was in another workspace.
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(
      bundle('other-workspace'),
    );
    useScope(otherWorkspace);
    const earlier = renderHook(
      () => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_B),
      { wrapper },
    );
    await waitFor(async () =>
      expect(
        await topicMemoriesResource.storage!.get({
          queryKey: topicMemoriesResource.storageKey(TOPIC_B),
          scope: rowScope,
        }),
      ).toBeDefined(),
    );
    earlier.unmount();

    // Back in the personal workspace, the user purges everything (server-side
    // the delete is user-wide).
    useScope(personal);
    renderHook(() => null, { wrapper });
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockImplementation(pending);
    await act(() => useUserMemoryStore.getState().purgeAllMemories());

    // Switching to the other workspace must not hydrate the purged bundle.
    useScope(otherWorkspace);
    const sync = renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_B), {
      wrapper,
    });
    await waitFor(() => expect(sync.result.current.isHydrated).toBe(true));
    expect(topicMemories(TOPIC_B)).toBeUndefined();
    sync.unmount();
  });

  it('surfaces a purge whose rows survive local storage, after the in-memory reset', async () => {
    renderHook(() => null, { wrapper });

    const storage = topicMemoriesResource.storage!;
    const remove = storage.remove.bind(storage);
    const rowKey = { queryKey: topicMemoriesResource.storageKey(TOPIC_B), scope: rowScope };
    const indexRowKey = { queryKey: REPLICA_INDEX_KEY, scope: rowScope };

    await storage.set(rowKey, { data: bundle('earlier-session'), updatedAt: 1 });
    await storage.set(indexRowKey, { data: [rowKey.queryKey], updatedAt: 1 });

    let failDeletes = true;
    vi.spyOn(storage, 'remove').mockImplementation(async (key) => {
      if (failDeletes) throw new Error('IndexedDB transaction aborted');
      return remove(key);
    });

    try {
      // What the user is looking at when they hit purge.
      act(() =>
        useUserMemoryStore.setState({ topicMemoriesMap: { [TOPIC_A]: bundle('in-memory') } }),
      );

      // Storage is unreachable for both attempts, so the purge must not report success.
      await act(async () => {
        await expect(useUserMemoryStore.getState().purgeAllMemories()).rejects.toThrow(
          /local storage/,
        );
      });

      // The in-memory reset still stands — purged memories must not stay visible,
      // and the row that could not be deleted is exactly what was surfaced.
      expect(topicMemories(TOPIC_A)).toBeUndefined();
      expect(agentMemorySelectors.hasTopicMemories(TOPIC_A)(useUserMemoryStore.getState())).toBe(
        false,
      );
      expect(await storage.get(rowKey)).toBeDefined();
    } finally {
      // Let the suite's cleanup reach storage again.
      failDeletes = false;
    }
  });

  it('purges the deleted user’s bundles after an account switch, so they are never injected later', async () => {
    const rowOf = (topicId: string, scopeValue: string) =>
      topicMemoriesResource.storage!.get({
        queryKey: topicMemoriesResource.storageKey(topicId),
        scope: scopeValue,
      });
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(bundle('deleted'));
    const first = renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), {
      wrapper,
    });
    await waitFor(async () => expect((await rowOf(TOPIC_A, rowScope))?.data).toBeDefined());
    first.unmount();
    const deletedUser = rowScope;

    // Another account becomes active and caches its own bundle.
    useScope(`memory-user-${randomUUID()}:personal`);
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(bundle('active'));
    renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_B), { wrapper });
    await waitFor(async () => expect((await rowOf(TOPIC_B, rowScope))?.data).toBeDefined());

    let cleared = false;
    await act(async () => {
      cleared = await useUserMemoryStore.getState().internal_clearTopicMemories(deletedUser);
    });

    expect(cleared).toBe(true);
    await expect(rowOf(TOPIC_A, deletedUser)).resolves.toBeUndefined();
    // The active user's bundle (view and row) is untouched.
    expect(topicMemories(TOPIC_B)).toEqual(bundle('active'));
    expect((await rowOf(TOPIC_B, rowScope))?.data).toEqual(bundle('active'));
  });

  it('purges a deleted user’s bundle whose write was still queued when the account switched', async () => {
    const storage = topicMemoriesResource.storage!;
    const rowOf = (topicId: string, scopeValue: string) =>
      storage.get({ queryKey: topicMemoriesResource.storageKey(topicId), scope: scopeValue });
    const deletedUser = rowScope;
    // The deleted user's bundle write is slow to land in IndexedDB.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { set } = storage;
    vi.spyOn(storage, 'set').mockImplementation(async (key, row) => {
      if (key.scope === deletedUser) await held;
      return set(key, row);
    });
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(bundle('deleted'));
    const first = renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), {
      wrapper,
    });
    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(bundle('deleted')));
    first.unmount();

    // The account switches while that write is still queued; the purge runs now.
    useScope(`memory-user-${randomUUID()}:personal`);
    let purging!: Promise<boolean>;
    act(() => {
      purging = useUserMemoryStore.getState().internal_clearTopicMemories(deletedUser);
    });
    release();
    let cleared = false;
    await act(async () => {
      cleared = await purging;
    });

    expect(cleared).toBe(true);
    // The queued write landed before the purge's delete, never after it.
    await waitFor(async () => expect(await rowOf(TOPIC_A, deletedUser)).toBeUndefined());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await rowOf(TOPIC_A, deletedUser)).toBeUndefined();
  });

  it('bounds the persisted topic bundles to the most recently visited topics', async () => {
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockImplementation(async (topicId) =>
      bundle(topicId),
    );
    const topics = Array.from({ length: MAX_RECENT_TOPIC_MEMORIES + 2 }, (_, i) => `topic-${i}`);
    const rowOf = (topicId: string) =>
      topicMemoriesResource.storage!.get({
        queryKey: topicMemoriesResource.storageKey(topicId),
        scope: rowScope,
      });

    const hook = renderHook(
      (props: { topicId: string }) =>
        useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(props.topicId),
      { initialProps: { topicId: topics[0] }, wrapper },
    );
    for (const topicId of topics) {
      hook.rerender({ topicId });
      await waitFor(() => expect(topicMemories(topicId)).toEqual(bundle(topicId)));
    }

    // The oldest topics left memory and IndexedDB together; the recent ones stay.
    expect(Object.keys(useUserMemoryStore.getState().topicMemoriesMap)).toHaveLength(
      MAX_RECENT_TOPIC_MEMORIES,
    );
    expect(topicMemories(topics[0])).toBeUndefined();
    await waitFor(async () => expect(await rowOf(topics[0])).toBeUndefined());
    expect((await rowOf(topics.at(-1)!))?.data).toEqual(bundle(topics.at(-1)!));
    await Promise.all(
      topics.map((topicId) =>
        topicMemoriesResource.storage!.remove({
          queryKey: topicMemoriesResource.storageKey(topicId),
          scope: rowScope,
        }),
      ),
    );
  });

  it('does not fetch when there is no topic', async () => {
    renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(undefined), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(userMemoryService.retrieveMemoryForTopic).not.toHaveBeenCalled();
    expect(topicMemories(TOPIC_A)).toBeUndefined();
  });

  it('drops the previous identity’s bundles before the next identity paints', async () => {
    const fresh = bundle('fresh');
    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockResolvedValue(fresh);

    const sync = renderHook(() => useUserMemoryStore((s) => s.useFetchMemoriesForTopic)(TOPIC_A), {
      wrapper,
    });
    await waitFor(() => expect(topicMemories(TOPIC_A)).toEqual(fresh));

    vi.mocked(userMemoryService.retrieveMemoryForTopic).mockImplementation(pending);
    useScope(`memory-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(topicMemories(TOPIC_A)).toBeUndefined());
    expect(entry(TOPIC_A)).toBeUndefined();
  });
});
