/**
 * @vitest-environment happy-dom
 *
 * Generation batches are a `@lobechat/replica` resource with one entry per
 * topic (`generationBatchesMap[topicId]`): the persisted projection paints the
 * feed before the network answers, an unchanged response keeps the array
 * reference, and a cache-scope switch drops the previous identity's batches
 * before paint.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { generationBatchService } from '@/services/generationBatch';
import { useVideoStore } from '@/store/video';
import { generationBatchSelectors } from '@/store/video/slices/generationBatch/selectors';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';

import { initialGenerationBatchState } from './initialState';
import { generationBatchesResource } from './projection';

vi.mock('@/services/generationBatch', () => ({
  generationBatchService: {
    deleteGenerationBatch: vi.fn(),
    getGenerationBatches: vi.fn(),
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

const batch = (id: string): GenerationBatch =>
  ({
    id,
    provider: 'openai',
    model: 'dall-e-3',
    prompt: 'Test prompt',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    generations: [
      {
        id: `${id}-gen`,
        seed: 1,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        asyncTaskId: null,
        task: { id: `${id}-task`, status: AsyncTaskStatus.Success },
      },
    ],
  }) as unknown as GenerationBatch;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const TOPIC = 'gt_topic_1';
const STORAGE_KEY = generationBatchesResource.storageKey({ topicId: TOPIC });

const renderSync = () =>
  renderHook(() => useVideoStore((s) => s.useFetchGenerationBatches)(TOPIC), { wrapper });

describe('video generation batches replica', () => {
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
    vi.clearAllMocks();
    useScope(`video-user-${randomUUID()}:personal`);
    useVideoStore.setState({ ...initialGenerationBatchState, activeGenerationTopicId: TOPIC });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        generationBatchesResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted batches before the network answers', async () => {
    await generationBatchesResource.storage!.set(
      { queryKey: STORAGE_KEY, scope },
      { data: [batch('gb_cached')], updatedAt: 1 },
    );
    vi.spyOn(generationBatchService, 'getGenerationBatches').mockImplementation(pending);

    renderSync();

    await waitFor(() =>
      expect(
        generationBatchSelectors.isCurrentGenerationTopicLoaded(useVideoStore.getState()),
      ).toBe(true),
    );
    expect(useVideoStore.getState().generationBatchesMap[TOPIC][0].id).toBe('gb_cached');
  });

  it('keeps the batch reference when the server returns an unchanged list', async () => {
    const getBatches = vi
      .spyOn(generationBatchService, 'getGenerationBatches')
      .mockResolvedValue([batch('gb_1')]);
    renderSync();
    await waitFor(() =>
      expect(useVideoStore.getState().generationBatchesMap[TOPIC]).toHaveLength(1),
    );
    const before = useVideoStore.getState().generationBatchesMap[TOPIC];

    getBatches.mockResolvedValue([batch('gb_1')]);
    await act(() => useVideoStore.getState().refreshGenerationBatches());

    expect(useVideoStore.getState().generationBatchesMap[TOPIC]).toBe(before);
  });

  it('drops the previous scope’s batches on a cache-scope switch', async () => {
    const getBatches = vi
      .spyOn(generationBatchService, 'getGenerationBatches')
      .mockResolvedValue([batch('gb_1')]);
    const { rerender } = renderSync();
    await waitFor(() =>
      expect(useVideoStore.getState().generationBatchesMap[TOPIC]).toHaveLength(1),
    );

    // Switch identity: the new scope's batches are still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    getBatches.mockImplementation(pending);
    rerender();

    expect(useVideoStore.getState().generationBatchesMap).toEqual({});
    expect(generationBatchSelectors.isCurrentGenerationTopicLoaded(useVideoStore.getState())).toBe(
      false,
    );
  });

  it('loads the active topic’s batches from the server', async () => {
    vi.spyOn(generationBatchService, 'getGenerationBatches').mockResolvedValue([batch('gb_1')]);

    const { result } = renderSync();

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data?.[0].id).toBe('gb_1');
  });
});
