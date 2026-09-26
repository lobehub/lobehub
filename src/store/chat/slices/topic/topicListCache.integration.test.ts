/**
 * @vitest-environment happy-dom
 *
 * After a run ends, a reload briefly repainted the topic row with the running
 * spinner before it vanished again.
 *
 * The chain under test is the real one: `useFetchTopics` → tiered SWR provider
 * → IndexedDB → "reload" (fresh provider) → first paint before the network
 * answers. The run's terminal status is written optimistically (no refetch
 * follows it), so unless that write also reaches the persisted cache, the
 * cached page keeps the `running` snapshot taken mid-run and the sidebar paints
 * a spinner on a finished topic.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { type Cache, SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localDataCache } from '@/libs/swr/localDataCache';
import { createCacheProvider } from '@/libs/swr/localStorageProvider';
import { setScopedMutate } from '@/libs/swr/mutate';
import { topicService } from '@/services/topic';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import type { ChatTopic } from '@/types/topic';

import { useChatStore } from '../../store';

vi.mock('@/services/topic', () => ({
  topicService: { getTopics: vi.fn() },
}));

const SCOPE_PREFIX = 'topic-cache-user:personal';
const AGENT_ID = 'agent-lobe-14032';
const CONTAINER_KEY = topicMapKey({ agentId: AGENT_ID });

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

const cachedTopicStatus = async (scope: string): Promise<string | undefined> => {
  const entries = await localDataCache.entriesByScope(scope);
  for (const entry of entries) {
    if (!entry.key.includes('topic:list')) continue;
    const items = (entry.data as { data?: { items?: ChatTopic[] } })?.data?.items;
    const topic = items?.find((item) => item.id === runningTopic.id);
    if (topic) return topic.status ?? undefined;
  }
  return undefined;
};

describe('persisted topic list across a reload', () => {
  const scopes = new Set<string>();
  const createScope = () => {
    const scope = `${SCOPE_PREFIX}:${randomUUID()}`;
    scopes.add(scope);
    return scope;
  };

  beforeEach(() => {
    act(() => {
      useChatStore.setState({
        activeAgentId: AGENT_ID,
        activeGroupId: undefined,
        topicDataMap: {},
      });
    });
  });

  afterEach(async () => {
    await Promise.all([...scopes].map((scope) => localDataCache.clearScope(scope)));
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the run’s terminal status, not the mid-run `running` snapshot', async () => {
    const scope = createScope();
    // --- session 1: the list is fetched while the run is still going ---------
    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [runningTopic], total: 1 } as any);

    const provider1 = makeProvider(scope);
    const session1 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(provider1),
    });

    await waitFor(() => expect(session1.result.current.data?.items).toHaveLength(1));
    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('running'));

    // --- the run ends: an optimistic status write, with no refetch behind it -
    act(() => {
      useChatStore.getState().internal_dispatchTopic({
        id: runningTopic.id,
        type: 'updateTopic',
        value: { status: 'active' },
      });
    });

    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('active'));
    session1.unmount();

    // --- session 2 ("reload"): a slow network, so the cached page paints -----
    act(() => {
      useChatStore.setState({ topicDataMap: {} });
    });
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);

    const provider2 = makeProvider(scope);
    await provider2.hydrateScope?.();

    const session2 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(provider2),
    });

    await waitFor(() =>
      expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items).toHaveLength(1),
    );
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');

    session2.unmount();
  });

  it('keeps a terminal status after an older list request lands and the pending pin expires', async () => {
    const scope = createScope();
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now');

    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [runningTopic], total: 1 } as any);

    const provider1 = makeProvider(scope);
    const session1 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(provider1),
    });

    await waitFor(() => expect(session1.result.current.data?.items).toHaveLength(1));
    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('running'));

    // The terminal write wins in Zustand and the persisted cache first.
    act(() => {
      useChatStore.getState().internal_pinTopicStatus({
        agentId: AGENT_ID,
        status: 'active',
        topicId: runningTopic.id,
      });
    });
    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('active'));
    const cacheSetSpy = vi.spyOn(localDataCache, 'set');

    // A list request that started before the terminal write returns afterwards.
    // The pending-status pin keeps the mounted sidebar correct, but the raw SWR
    // response must not put `running` back into IndexedDB behind it.
    await act(async () => {
      await session1.result.current.mutate();
    });
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');
    await waitFor(() => expect(cacheSetSpy).toHaveBeenCalled());
    await Promise.all(cacheSetSpy.mock.results.map(({ value }) => value));
    expect(await cachedTopicStatus(scope)).toBe('active');

    // The normalized first response must not be mistaken for server
    // confirmation. A second older response can still be in flight and must be
    // pinned too.
    cacheSetSpy.mockClear();
    await act(async () => {
      await session1.result.current.mutate();
    });
    await waitFor(() => expect(cacheSetSpy).toHaveBeenCalled());
    await Promise.all(cacheSetSpy.mock.results.map(({ value }) => value));
    expect(await cachedTopicStatus(scope)).toBe('active');
    session1.unmount();

    // Regression: after the 15-second pending pin elapsed, navigating away and
    // back remounted the sidebar from that stale IndexedDB snapshot and restored
    // the yellow running spinner until the network response arrived.
    nowSpy.mockReturnValue(now + 16_000);
    act(() => {
      useChatStore.setState({ topicDataMap: {} });
    });
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);

    const provider2 = makeProvider(scope);
    await provider2.hydrateScope?.();

    const session2 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(provider2),
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
      expect(primedAgentView.result.current.data?.items[0].status).toBe('active'),
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
    await waitFor(() => expect(sidebar.result.current.data?.items[0].status).toBe('running'));
    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('running'));

    act(() => {
      useChatStore.getState().internal_pinTopicStatus({
        agentId: AGENT_ID,
        status: 'active',
        topicId: runningTopic.id,
      });
    });
    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('active'));

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
      await sidebar.result.current.mutate();
    });
    expect(useChatStore.getState().topicDataMap[CONTAINER_KEY]?.items[0].status).toBe('active');
    await waitFor(async () => expect(await cachedTopicStatus(scope)).toBe('active'));

    replayedAgentView.unmount();
    sidebar.unmount();
  });
});
