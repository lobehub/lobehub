'use client';

import { useEffect, useRef } from 'react';

import { DOCUMENT_HISTORY_QUERY_LIST_LIMIT } from '@/const/documentHistory';
import { createReplicaSlice, recordLens } from '@/libs/replica';
import type {
  CompareHistoryItemsOutput,
  ListHistoryOutput,
} from '@/server/routers/lambda/_schema/documentHistory';
import { documentService } from '@/services/document';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';
import { useDocumentStore } from '../../store';
import {
  documentHistoryCompareKey,
  type DocumentHistoryCompareParams,
  documentHistoryCompareResource,
  documentHistoryListResource,
} from './projection';

const n = setNamespace('document/history');

type Setter = StoreSetter<DocumentStore>;

export interface UseFetchDocumentHistoryResult<TData> {
  data: TData | undefined;
  error: unknown;
  /** No value painted yet (neither the persisted copy nor the network) and no error. */
  isLoading: boolean;
}

/**
 * Re-read an entry whenever the document's saved revision moves on while the
 * view is mounted. The first render only syncs (mount revalidation); the
 * revision is not part of the replica key, so a save keeps the painted list
 * on screen while the new one loads instead of falling back to a skeleton.
 */
const useRevalidateOnRevision = (
  key: string | undefined,
  revision: string | null | undefined,
  revalidate: (key: string) => Promise<unknown>,
) => {
  const seen = useRef({ key, revision });
  useEffect(() => {
    const previous = seen.current;
    seen.current = { key, revision };
    if (!key || previous.key !== key || previous.revision === revision) return;
    void revalidate(key);
  }, [key, revision, revalidate]);
};

export const createDocumentHistorySlice = (set: Setter, get: () => DocumentStore, _api?: unknown) =>
  new DocumentHistoryActionImpl(set, get, _api);

/**
 * The version history of a document: its version list and head-vs-version
 * diffs live in replicas next to the document detail, so reopening the
 * history panel (or a compare) after a reload paints the last copy first.
 */
export class DocumentHistoryActionImpl {
  readonly #compare;
  readonly #list;

  constructor(set: Setter, get: () => DocumentStore, _api?: unknown) {
    void _api;
    this.#list = createReplicaSlice(documentHistoryListResource, {
      actionPrefix: n('historyList'),
      fetcher: (documentId) =>
        documentService.listDocumentHistory({
          documentId,
          includeCurrent: true,
          limit: DOCUMENT_HISTORY_QUERY_LIST_LIMIT,
        }),
      get,
      set,
      stateKey: 'historyListReplica',
      view: recordLens<DocumentStore, ListHistoryOutput>('historyListMap'),
    });
    this.#compare = createReplicaSlice(documentHistoryCompareResource, {
      actionPrefix: n('historyCompare'),
      fetcher: ({ documentId, historyId }) =>
        documentService.compareDocumentHistoryItems({
          documentId,
          fromHistoryId: 'head',
          toHistoryId: historyId,
        }),
      get,
      set,
      stateKey: 'historyCompareReplica',
      view: recordLens<DocumentStore, CompareHistoryItemsOutput>('historyCompareMap'),
    });
  }

  #revalidateList = (key: string) => this.#list.revalidate(key);

  #revalidateCompare = (key: string) => this.#compare.revalidate(key);

  /**
   * The version list of `documentId`; `revision` (the document's last saved
   * time) re-reads it after every save.
   */
  useFetchDocumentHistory = (
    documentId: string | null | undefined,
    revision?: string | null,
  ): UseFetchDocumentHistoryResult<ListHistoryOutput> => {
    const data = useDocumentStore((s) => (documentId ? s.historyListMap[documentId] : undefined));
    const sync = this.#list.useSync(documentId || null);
    useRevalidateOnRevision(documentId || undefined, revision, this.#revalidateList);

    return {
      data,
      error: sync.error,
      isLoading: Boolean(documentId) && !data && !sync.error,
    };
  };

  /**
   * The diff between the document head and one version; `revision` re-reads
   * it when the head moves on.
   */
  useFetchDocumentHistoryCompare = (
    params: DocumentHistoryCompareParams | null | undefined,
    revision?: string | null,
  ): UseFetchDocumentHistoryResult<CompareHistoryItemsOutput> => {
    const key = params ? documentHistoryCompareKey(params) : undefined;
    const data = useDocumentStore((s) => (key ? s.historyCompareMap[key] : undefined));
    const sync = this.#compare.useSync(params ?? null);
    useRevalidateOnRevision(key, revision, this.#revalidateCompare);

    return { data, error: sync.error, isLoading: Boolean(key) && !data && !sync.error };
  };
}

export type DocumentHistoryAction = Pick<
  DocumentHistoryActionImpl,
  keyof DocumentHistoryActionImpl
>;
