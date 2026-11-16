/**
 * @vitest-environment happy-dom
 *
 * The page editor's version list and head-vs-version diff live in the document
 * store's replicas: a reload paints the last list from storage instead of a
 * skeleton, and a save re-reads it while the painted list stays on screen.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import type { ListHistoryOutput } from '@/server/routers/lambda/_schema/documentHistory';
import { documentService } from '@/services/document';

import { useDocumentStore } from '../../store';
import { documentHistoryCompareResource, documentHistoryListResource } from './projection';

const DOCUMENT_ID = 'doc-history-1';

const list = (...ids: string[]): ListHistoryOutput => ({
  items: ids.map((id, index) => ({
    id,
    isCurrent: index === 0,
    savedAt: `2026-10-0${index + 1}T00:00:00.000Z`,
    saveSource: 'autosave',
    userId: 'user-1',
  })),
});

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

describe('document history replicas', () => {
  let scope = '';

  beforeEach(() => {
    scope = `doc-history-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useDocumentStore.getState().reset());
  });

  afterEach(async () => {
    cleanup();
    await documentHistoryListResource.storage!.remove({ queryKey: DOCUMENT_ID, scope });
    await documentHistoryCompareResource.storage!.remove({
      queryKey: documentHistoryCompareResource.storageKey({
        documentId: DOCUMENT_ID,
        historyId: 'h2',
      }),
      scope,
    });
    vi.restoreAllMocks();
  });

  it('paints the persisted version list before the network answers', async () => {
    await documentHistoryListResource.storage!.set(
      { queryKey: DOCUMENT_ID, scope },
      { data: list('h1', 'h2'), updatedAt: 1 },
    );
    vi.spyOn(documentService, 'listDocumentHistory').mockImplementation(pending);

    const hook = renderHook(
      () => useDocumentStore.getState().useFetchDocumentHistory(DOCUMENT_ID, 'rev-1'),
      { wrapper },
    );

    await waitFor(() =>
      expect(hook.result.current.data?.items.map(({ id }) => id)).toEqual(['h1', 'h2']),
    );
    expect(hook.result.current.isLoading).toBe(false);
  });

  it('re-reads the list after a save while keeping the painted one', async () => {
    const listHistory = vi
      .spyOn(documentService, 'listDocumentHistory')
      .mockResolvedValueOnce(list('h1'))
      .mockResolvedValueOnce(list('h0', 'h1'));

    const hook = renderHook(
      ({ revision }) => useDocumentStore.getState().useFetchDocumentHistory(DOCUMENT_ID, revision),
      { initialProps: { revision: 'rev-1' }, wrapper },
    );
    await waitFor(() => expect(hook.result.current.data?.items).toHaveLength(1));

    hook.rerender({ revision: 'rev-2' });
    expect(hook.result.current.data?.items).toHaveLength(1);

    await waitFor(() =>
      expect(hook.result.current.data?.items.map(({ id }) => id)).toEqual(['h0', 'h1']),
    );
    expect(listHistory).toHaveBeenCalledTimes(2);
    expect(listHistory).toHaveBeenLastCalledWith({
      documentId: DOCUMENT_ID,
      includeCurrent: true,
      limit: expect.any(Number),
    });
    await waitFor(async () => {
      const row = await documentHistoryListResource.storage!.get({ queryKey: DOCUMENT_ID, scope });
      expect((row?.data as ListHistoryOutput).items).toHaveLength(2);
    });
  });

  it('fetches a head-vs-version diff into its replica entry', async () => {
    const compare = {
      from: { editorData: { root: { children: [] } } },
      to: { editorData: { root: { children: [] } } },
    };
    const compareSpy = vi
      .spyOn(documentService, 'compareDocumentHistoryItems')
      .mockResolvedValue(compare as never);

    const hook = renderHook(
      () =>
        useDocumentStore
          .getState()
          .useFetchDocumentHistoryCompare({ documentId: DOCUMENT_ID, historyId: 'h2' }, 'rev-1'),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(compare));
    expect(compareSpy).toHaveBeenCalledWith({
      documentId: DOCUMENT_ID,
      fromHistoryId: 'head',
      toHistoryId: 'h2',
    });
  });
});
