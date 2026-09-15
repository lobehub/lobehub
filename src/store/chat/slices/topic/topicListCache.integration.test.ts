/**
 * @vitest-environment happy-dom
 *
 * LOBE-14032: after a run ends, a reload briefly repainted the topic row with
 * the running spinner before it vanished again.
 *
 * The chain under test is the real one: `useFetchTopics` → tiered SWR provider
 * → IndexedDB → "reload" (fresh provider) → first paint before the network
 * answers. The run's terminal status is written optimistically (no refetch
 * follows it), so unless that write also reaches the persisted cache, the
 * cached page keeps the `running` snapshot taken mid-run and the sidebar paints
 * a spinner on a finished topic.
 */
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

const SCOPE = 'topic-cache-user:personal';
const AGENT_ID = 'agent-lobe-14032';
const CONTAINER_KEY = topicMapKey({ agentId: AGENT_ID });

const makeProvider = () =>
  createCacheProvider({
    debounceMs: 5,
    getScope: () => SCOPE,
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

const cachedTopicStatus = async (): Promise<string | undefined> => {
  const entries = await localDataCache.entriesByScope(SCOPE);
  for (const entry of entries) {
    const items = (entry.data as { data?: { items?: ChatTopic[] } })?.data?.items;
    const topic = items?.find((item) => item.id === runningTopic.id);
    if (topic) return topic.status ?? undefined;
  }
  return undefined;
};

describe('persisted topic list across a reload', () => {
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
    await localDataCache.clearScope(SCOPE);
    vi.clearAllMocks();
  });

  it('paints the run’s terminal status, not the mid-run `running` snapshot', async () => {
    // --- session 1: the list is fetched while the run is still going ---------
    vi.mocked(topicService.getTopics).mockResolvedValue({ items: [runningTopic], total: 1 } as any);

    const session1 = renderHook(() => useChatStore().useFetchTopics(true, { agentId: AGENT_ID }), {
      wrapper: wrapper(makeProvider()),
    });

    await waitFor(() => expect(session1.result.current.data?.items).toHaveLength(1));
    await waitFor(async () => expect(await cachedTopicStatus()).toBe('running'));

    // --- the run ends: an optimistic status write, with no refetch behind it -
    act(() => {
      useChatStore.getState().internal_dispatchTopic({
        id: runningTopic.id,
        type: 'updateTopic',
        value: { status: 'active' },
      });
    });

    await waitFor(async () => expect(await cachedTopicStatus()).toBe('active'));
    session1.unmount();

    // --- session 2 ("reload"): a slow network, so the cached page paints -----
    act(() => {
      useChatStore.setState({ topicDataMap: {} });
    });
    vi.mocked(topicService.getTopics).mockReturnValue(new Promise<never>(() => {}) as any);

    const provider2 = makeProvider();
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
});
