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
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { userMemoryService } from '@/services/userMemory';
import { type RetrieveMemoryResult } from '@/types/userMemory';

import { initialState as userMemoryInitialState } from '../../initialState';
import { useUserMemoryStore } from '../../store';
import { topicMemoriesResource } from './projection';
import { agentMemorySelectors } from './selectors';

vi.mock('@/services/userMemory', () => ({
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
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
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
      { queryKey: topicMemoriesResource.storageKey(TOPIC_A), scope },
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
            scope,
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
          scope,
        }),
      ).toBeUndefined(),
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
