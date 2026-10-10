/**
 * @vitest-environment happy-dom
 *
 * A topic's notebook documents are a replica: they paint from the persisted
 * copy on the first frame and the network only confirms, keyed per topic so
 * switching topics never leaks the previous topic's rows.
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { notebookService } from '@/services/notebook';

import { initialNotebookState } from './initialState';
import { type NotebookDocument, notebookDocumentsResource } from './projection';
import { getNotebookStoreState, useNotebookStore } from './store';

vi.mock('@/services/notebook', () => ({
  notebookService: {
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    getDocument: vi.fn(),
    listDocuments: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: { getState: () => ({ closeDocument: vi.fn(), portalDocumentId: undefined }) },
}));

vi.mock('@/services/document/invalidation', () => ({
  invalidateDocumentMutation: vi.fn(async () => undefined),
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

const doc = (id: string): NotebookDocument =>
  ({
    associatedAt: new Date(0),
    content: null,
    createdAt: new Date(0),
    description: null,
    fileType: 'markdown',
    id,
    metadata: {},
    title: id,
    totalCharCount: 0,
    totalLineCount: 0,
    updatedAt: new Date(0),
  }) as unknown as NotebookDocument;

const storageKeyFor = (topicId: string) => notebookDocumentsResource.storageKey(topicId);

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

describe('notebook store replica', () => {
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
    useScope(`notebook-user-${randomUUID()}:personal`);
    act(() => useNotebookStore.setState(initialNotebookState));
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        ['topic-1', 'topic-2'].map((topicId) =>
          notebookDocumentsResource.storage!.remove({
            queryKey: storageKeyFor(topicId),
            scope: value,
          }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted documents of a topic before the network answers', async () => {
    await notebookDocumentsResource.storage!.set(
      { queryKey: storageKeyFor('topic-1'), scope },
      { data: [doc('cached')], updatedAt: 1 },
    );
    vi.mocked(notebookService.listDocuments).mockImplementation(pending as any);

    const sync = renderHook(() => useNotebookStore((s) => s.useFetchDocuments)('topic-1'), {
      wrapper,
    });

    await waitFor(() =>
      expect(getNotebookStoreState().notebookMap['topic-1']?.map((d) => d.id)).toEqual(['cached']),
    );
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the topic list with the server response and persists it', async () => {
    vi.mocked(notebookService.listDocuments).mockResolvedValue({
      data: [doc('server')],
      total: 1,
    } as any);

    renderHook(() => useNotebookStore((s) => s.useFetchDocuments)('topic-1'), { wrapper });

    await waitFor(() =>
      expect(getNotebookStoreState().notebookMap['topic-1']?.[0]?.id).toBe('server'),
    );
    await waitFor(async () =>
      expect(
        (
          await notebookDocumentsResource.storage!.get({
            queryKey: storageKeyFor('topic-1'),
            scope,
          })
        )?.data,
      ).toEqual([doc('server')]),
    );
  });

  it('keeps each topic in its own entry', async () => {
    vi.mocked(notebookService.listDocuments).mockImplementation(
      async ({ topicId }) => ({ data: [doc(`${topicId}-doc`)], total: 1 }) as any,
    );

    renderHook(
      () => {
        useNotebookStore((s) => s.useFetchDocuments)('topic-1');
        useNotebookStore((s) => s.useFetchDocuments)('topic-2');
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(getNotebookStoreState().notebookMap['topic-1']?.[0]?.id).toBe('topic-1-doc');
      expect(getNotebookStoreState().notebookMap['topic-2']?.[0]?.id).toBe('topic-2-doc');
    });
  });

  it('refreshDocuments revalidates the network for that topic', async () => {
    vi.mocked(notebookService.listDocuments).mockResolvedValue({
      data: [doc('first')],
      total: 1,
    } as any);
    renderHook(() => useNotebookStore((s) => s.useFetchDocuments)('topic-1'), { wrapper });
    await waitFor(() =>
      expect(getNotebookStoreState().notebookMap['topic-1']?.[0]?.id).toBe('first'),
    );

    vi.mocked(notebookService.listDocuments).mockResolvedValue({
      data: [doc('second')],
      total: 1,
    } as any);
    await act(async () => {
      await getNotebookStoreState().refreshDocuments('topic-1');
    });

    await waitFor(() =>
      expect(getNotebookStoreState().notebookMap['topic-1']?.[0]?.id).toBe('second'),
    );
  });
});
