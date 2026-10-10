/**
 * @vitest-environment happy-dom
 *
 * The image generation topic list is a `@lobechat/replica` resource whose view
 * is the image store's `generationTopics` field: the persisted projection paints
 * while the network confirms it, an unchanged response keeps the array
 * reference, a cache-scope switch drops the previous identity's topics before
 * paint, and a create revalidates the list so the new topic appears.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { generationTopicService } from '@/services/generationTopic';
import { useImageStore } from '@/store/image';
import { generationTopicSelectors } from '@/store/image/slices/generationTopic/selectors';
import { type ImageGenerationTopic } from '@/types/generation';

import { initialGenerationTopicState } from './initialState';
import { generationTopicsResource } from './projection';

vi.mock('@/services/generationTopic', () => ({
  generationTopicService: {
    createTopic: vi.fn(),
    deleteTopic: vi.fn(),
    getAllGenerationTopics: vi.fn(),
    setTopicVisibility: vi.fn(),
    updateTopic: vi.fn(),
    updateTopicCover: vi.fn(),
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

const topic = (id: string, overrides: Partial<ImageGenerationTopic> = {}): ImageGenerationTopic =>
  ({
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    id,
    title: id,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as ImageGenerationTopic;

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const STORAGE_KEY = generationTopicsResource.storageKey({});

const renderSync = () =>
  renderHook(() => useImageStore((s) => s.useFetchGenerationTopics)(true), { wrapper });

describe('image generation topics replica', () => {
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
    useScope(`image-user-${randomUUID()}:personal`);
    useImageStore.setState({ ...initialGenerationTopicState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        generationTopicsResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted topics before the network answers', async () => {
    await generationTopicsResource.storage!.set(
      { queryKey: STORAGE_KEY, scope },
      { data: [topic('t1', { title: 'Cached' })], updatedAt: 1 },
    );
    vi.spyOn(generationTopicService, 'getAllGenerationTopics').mockImplementation(pending);

    renderSync();

    await waitFor(() => expect(useImageStore.getState().isGenerationTopicsInit).toBe(true));
    expect(generationTopicSelectors.generationTopics(useImageStore.getState())[0].title).toBe(
      'Cached',
    );
  });

  it('reports `data` only after the list has loaded at least once', async () => {
    vi.spyOn(generationTopicService, 'getAllGenerationTopics').mockResolvedValue([topic('t1')]);

    const { result } = renderSync();

    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it('keeps the list reference when the server returns an unchanged list', async () => {
    const getAll = vi
      .spyOn(generationTopicService, 'getAllGenerationTopics')
      .mockResolvedValue([topic('t1')]);
    renderSync();
    await waitFor(() => expect(useImageStore.getState().generationTopics).toHaveLength(1));
    const before = useImageStore.getState().generationTopics;

    getAll.mockResolvedValue([topic('t1')]);
    await act(() => useImageStore.getState().refreshGenerationTopics());

    expect(useImageStore.getState().generationTopics).toBe(before);
  });

  it('drops the previous scope’s topics on a cache-scope switch', async () => {
    const getAll = vi
      .spyOn(generationTopicService, 'getAllGenerationTopics')
      .mockResolvedValue([topic('t1', { title: 'Personal' })]);
    const { rerender } = renderSync();
    await waitFor(() => expect(useImageStore.getState().generationTopics).toHaveLength(1));

    // Switch identity: the new scope's list is still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    getAll.mockImplementation(pending);
    rerender();

    expect(useImageStore.getState().generationTopics).toEqual([]);
    expect(useImageStore.getState().isGenerationTopicsInit).toBe(false);
  });

  it('refreshes the list after a topic is created', async () => {
    const getAll = vi.spyOn(generationTopicService, 'getAllGenerationTopics').mockResolvedValue([]);
    vi.spyOn(generationTopicService, 'createTopic').mockResolvedValue('t1');
    renderSync();
    await waitFor(() => expect(useImageStore.getState().isGenerationTopicsInit).toBe(true));

    getAll.mockResolvedValue([topic('t1', { title: 'Fresh' })]);
    await act(() => useImageStore.getState().internal_createGenerationTopic());

    await waitFor(() =>
      expect(generationTopicSelectors.generationTopics(useImageStore.getState())).toHaveLength(1),
    );
    expect(generationTopicSelectors.generationTopics(useImageStore.getState())[0].title).toBe(
      'Fresh',
    );
  });
});
