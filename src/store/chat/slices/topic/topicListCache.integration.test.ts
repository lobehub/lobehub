/**
 * @vitest-environment happy-dom
 *
 * After a run ends, a reload briefly repainted the topic row with the running
 * spinner before it vanished again.
 *
 * The chain under test is the real one: `useFetchTopics` → local-first topic
 * list resource → IndexedDB query projection → "reload" (fresh store + SWR
 * cache) → first paint before the network answers. The run's terminal status
 * is written optimistically (no refetch follows it), so unless that write also
 * reaches the persisted projection, the cached page keeps the `running`
 * snapshot taken mid-run and the sidebar paints a spinner on a finished topic.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { type Cache, SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { localDataCache } from '@/libs/swr/localDataCache';
import { createCacheProvider } from '@/libs/swr/localStorageProvider';
import { setScopedMutate } from '@/libs/swr/mutate';
import { topicService } from '@/services/topic';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';

import { useChatStore } from '../../store';
import { topicListResource } from './projection';

vi.mock('@/services/topic', () => ({
  topicService: { getTopics: vi.fn() },
}));

const SCOPE_PREFIX = 'topic-cache-user:personal';
const AGENT_ID = 'agent-lobe-14032';
const CONTAINER_KEY = topicMapKey({ agentId: AGENT_ID });

/** SWR provider as in the app: `topic:` (agent view, search) still persists via SWR. */
const makeProvider = (scope: string) =>
  createCacheProvider({
    debounceMs: 5,
    getScope: () => scope,
    idbPatterns: ['topic:'],
    localPatterns: [],
  });

/** Publish the scoped mutate the way `SWRProvider` does in the app. */
const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper =
  (provider: ReturnType<typeof createCacheProvider>) =>
  ({ children }: PropsWithChildren) =>
    createElement(
      SWRConfig,
      { value: { provider: provider as unknown as (c: Readonly<Cache>) => Cache } },
      createElement(MutateBridge),
      children,
    );

const runningTopic = { id: 'tpc-lobe-14032', status: 'running', title: '抚州明天天气查询' };

// Default sidebar params (no filters) — rows are stored per query.
const SIDEBAR_STORAGE_KEY = topicListResource.storageKey({ agentId: AGENT_ID, pageSize: 20 });

const persistedTopicStatus = async (
  scope: string,
  topicId = runningTopic.id,
): Promise<string | undefined> => {
  const projection = await topicListResource.storage!.get({ queryKey: SIDEBAR_STORAGE_KEY, scope });
  return projection?.data.items.find((item) => item.id === topicId)?.status ?? undefined;
};

/** A reload: memory is gone, only the persisted projection survives. */
const reloadStore = () =>
  act(() => {
    useChatStore.setState({ topicDataMap: {}, topicListReplica: createReplicaState() });
  });

describe('persisted topic list across a reload', () => {
  const scopes = new Set<string>();
  const useScope = (scope: string) => {
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    return scope;
  };
  const createScope = () => useScope(`${SCOPE_PREFIX}:${randomUUID()}`);

  beforeEach(() => {
    act(() => {
      useChatStore.setState({
        activeAgentId: AGENT_ID,
        activeGroupId: undefined,
        topicDataMap: {},
        topicListReplica: createReplicaState(),
      });
    });
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((scope) => [
        localDataCache.clearScope(scope),
        topicListResource.storage!.remove({ queryKey: SIDEBAR_STORAGE_KEY, scope }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the run’s terminal status, not the mid-run `running` snapshot', async () => {
    const scope = createScope();
    // --- session 1: the list is fetched while the run is still going ---------
    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [runningTopic], total: 1 } as any);

    const session1 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scope)),
    });

    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items).toHaveLength(1),
    );
    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('running'));

    // --- the run ends: an optimistic status write, with no refetch behind it -
    act(() => {
      useChatStore.getState().internal_dispatchTopic({
        id: runningTopic.id,
        type: 'updateTopic',
        value: { status: 'active' },
      });
    });

    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('active'));
    session1.unmount();

    // --- session 2 ("reload"): a slow network, so the persisted page paints --
    reloadStore();
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);

    const session2 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scope)),
    });

    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items).toHaveLength(1),
    );
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');
    // Background loading does not hide the hydrated list.
    expect(session2.result.current.isValidating).toBe(true);
    expect(session2.result.current.isHydrated).toBe(true);

    session2.unmount();
  });

  it('keeps a terminal status after an older list request lands and the pending pin expires', async () => {
    const scope = createScope();
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now');

    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [runningTopic], total: 1 } as any);

    const session1 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scope)),
    });

    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items).toHaveLength(1),
    );
    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('running'));

    // The terminal write wins in Zustand and the persisted projection first.
    act(() => {
      useChatStore.getState().internal_pinTopicStatus({
        agentId: AGENT_ID,
        status: 'active',
        topicId: runningTopic.id,
      });
    });
    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('active'));
    const persistSpy = vi.spyOn(topicListResource.storage!, 'set');

    // A list request that started before the terminal write returns afterwards.
    // The pending-status pin keeps the mounted sidebar correct, and the server
    // replace must not put `running` back into IndexedDB behind it.
    await act(async () => {
      await session1.result.current.revalidate();
    });
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');
    await waitFor(() => expect(persistSpy).toHaveBeenCalled());
    await Promise.all(persistSpy.mock.results.map(({ value }) => value));
    expect(await persistedTopicStatus(scope)).toBe('active');

    // The normalized first response must not be mistaken for server
    // confirmation. A second older response can still be in flight and must be
    // pinned too.
    persistSpy.mockClear();
    await act(async () => {
      await session1.result.current.revalidate();
    });
    await waitFor(() => expect(persistSpy).toHaveBeenCalled());
    await Promise.all(persistSpy.mock.results.map(({ value }) => value));
    expect(await persistedTopicStatus(scope)).toBe('active');
    session1.unmount();

    // Regression: after the 15-second pending pin elapsed, navigating away and
    // back remounted the sidebar from a stale snapshot and restored the yellow
    // running spinner until the network response arrived.
    nowSpy.mockReturnValue(now + 16_000);
    reloadStore();
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);

    const session2 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scope)),
    });

    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items).toHaveLength(1),
    );
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');

    session2.unmount();
  });

  it('does not treat a cached agent-view row as server confirmation', async () => {
    const scope = createScope();
    const provider = makeProvider(scope);
    const activeTopic = { ...runningTopic, status: 'active' };

    // Prime the management-page cache with the same status a later terminal
    // pin will carry. Replaying this row must not count as a server round-trip.
    vi.mocked(topicService.getTopics).mockResolvedValue({
      items: [activeTopic],
      total: 1,
    } as any);
    const primedAgentView = renderHook(
      () =>
        useChatStore().useFetchAgentTopicsView(true, {
          agentId: AGENT_ID,
          withDetails: true,
        }),
      { wrapper: wrapper(provider) },
    );
    await waitFor(() =>
      expect(useChatStore.getState().agentTopicsViewMap[CONTAINER_KEY]?.items[0].status).toBe(
        'active',
      ),
    );
    primedAgentView.unmount();

    vi.mocked(topicService.getTopics).mockImplementation(({ withDetails }) =>
      withDetails
        ? (new Promise<never>(() => {}) as any)
        : (Promise.resolve({ items: [runningTopic], total: 1 }) as any),
    );

    const sidebar = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(provider),
    });
    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('running'),
    );
    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('running'));

    act(() => {
      useChatStore.getState().internal_pinTopicStatus({
        agentId: AGENT_ID,
        status: 'active',
        topicId: runningTopic.id,
      });
    });
    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('active'));

    const replayedAgentView = renderHook(
      () =>
        useChatStore().useFetchAgentTopicsView(true, {
          agentId: AGENT_ID,
          withDetails: true,
        }),
      { wrapper: wrapper(provider) },
    );
    await waitFor(() =>
      expect(useChatStore.getState().agentTopicsViewMap[CONTAINER_KEY]?.items[0].status).toBe(
        'active',
      ),
    );

    // If the cached management row cleared the pin, this stale sidebar response
    // would restore `running` in both Zustand and IndexedDB.
    await act(async () => {
      await sidebar.result.current.revalidate();
    });
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');
    await waitFor(async () => expect(await persistedTopicStatus(scope)).toBe('active'));

    replayedAgentView.unmount();
    sidebar.unmount();
  });

  it('patches the persisted list of a container that is not loaded (Codex P1)', async () => {
    const scope = createScope();
    // Own id: other tests leave pending status pins on `runningTopic`.
    const topic = { ...runningTopic, id: 'tpc-unloaded-container' };
    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [topic], total: 1 } as any);
    const session1 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scope)),
    });
    await waitFor(async () => expect(await persistedTopicStatus(scope, topic.id)).toBe('running'));
    session1.unmount();

    // The user navigated elsewhere: the owning bucket is no longer in memory.
    reloadStore();
    act(() => useChatStore.setState({ activeAgentId: 'another-agent' }));

    // The run finishes for the unloaded container.
    act(() => {
      useChatStore.getState().internal_dispatchTopic({
        agentId: AGENT_ID,
        id: topic.id,
        type: 'updateTopic',
        value: { status: 'unread' },
      });
    });
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]).toBeUndefined();
    await waitFor(async () => expect(await persistedTopicStatus(scope, topic.id)).toBe('unread'));

    // The next visit hydrates the terminal status, not the stale spinner.
    act(() => useChatStore.setState({ activeAgentId: AGENT_ID }));
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);
    const visit = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scope)),
    });
    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0]?.status).toBe('unread'),
    );
    visit.unmount();
  });

  it('does not repaint another identity’s persisted list after a scope switch', async () => {
    const scopeA = createScope();
    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [runningTopic], total: 1 } as any);
    const sessionA = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scopeA)),
    });
    // (status may carry an earlier test's pending pin — only presence matters)
    await waitFor(async () => expect(await persistedTopicStatus(scopeA)).toBeDefined());
    sessionA.unmount();

    // Same device, another user (or workspace membership) — same container key.
    const scopeB = useScope(`${SCOPE_PREFIX}:${randomUUID()}`);
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);
    const sessionB = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider(scopeB)),
    });

    await waitFor(() => expect(sessionB.result.current.isHydrated).toBe(true));
    // Memory from scope A is cleared and scope B has nothing persisted.
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]).toBeUndefined();
    expect(useChatStore.getState().topicListReplica.scope).toBe(scopeB);
    sessionB.unmount();
  });
});
