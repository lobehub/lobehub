import { createReplicaSlice, linkReplicaEntity, recordLens, singleEntity } from '@/libs/replica';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import { documentService } from '@/services/document';
import { useGlobalStore } from '@/store/global';
import type { StoreSetter } from '@/store/types';
import { type LobeDocument } from '@/types/document';

import { type PageState } from './initialState';
import {
  documentItemToLobeDocument,
  isTempPageId,
  PAGE_LIST_KEY,
  pageDetailResource,
  pageListResource,
  type PageListValue,
} from './projection';

const DEFAULT_PAGE_SIZE = 20;

export const currentPageSize = (): number =>
  useGlobalStore.getState().status.pagePageSize || DEFAULT_PAGE_SIZE;

type Setter = StoreSetter<PageState>;

export class PagePrivateAction {
  readonly #get: () => PageState;
  readonly detail;
  readonly entity;
  readonly list;

  constructor(set: Setter, get: () => PageState) {
    this.#get = get;

    this.list = createReplicaSlice(pageListResource, {
      actionPrefix: 'pageList',
      get,
      // A page the user just created shows before its server row exists and
      // survives a head refresh until its temp id is swapped for the real one.
      isClientOnly: (doc) => isTempPageId(doc.id),
      set,
      stateKey: 'pageListReplica',
      view: recordLens<PageState, PageListValue>('pageListMap'),
    });
    this.detail = createReplicaSlice(pageDetailResource, {
      actionPrefix: 'pageDetail',
      entity: singleEntity<LobeDocument>((doc) => doc.id),
      fetcher: async (pageId) => {
        const document = await documentService.getDocumentById(pageId);
        return document ? documentItemToLobeDocument(document) : undefined;
      },
      get,
      // A miss keeps whatever is cached — the list may still hold the row.
      merge: (incoming) => incoming,
      set,
      stateKey: 'pageDetailReplica',
      view: recordLens<PageState, LobeDocument>('pageDetailMap'),
    });
    this.entity = linkReplicaEntity<LobeDocument>([this.list, this.detail]);
  }

  insertListRow = (doc: LobeDocument): void => {
    if (this.#get().pageListMap[PAGE_LIST_KEY]) {
      this.list.insertHead(PAGE_LIST_KEY, [doc]);
      return;
    }

    // No list loaded yet (mobile, or before the first page arrives): seed a
    // single-row head page so the new page renders immediately. The next sync
    // replaces the head page with the server's for every other row.
    this.list.update(
      PAGE_LIST_KEY,
      () => ({
        currentPage: 0,
        hasMore: false,
        items: [doc],
        pageSize: currentPageSize(),
        total: 1,
      }),
      { persist: false },
    );
  };

  replaceListRow = (tempId: string, doc: LobeDocument): void => {
    this.list.update(PAGE_LIST_KEY, (data) =>
      data ? { ...data, items: data.items.map((item) => (item.id === tempId ? doc : item)) } : data,
    );
  };

  revalidateList = (): Promise<unknown> => this.list.revalidate(PAGE_LIST_KEY);

  preHydrateList = (): Promise<boolean> => {
    const scope = getCacheScope();
    // The slot may still hold the previous identity's rows; drop them before seeding.
    this.list.ensureScope(scope);
    return this.list.hydrate({ pageSize: currentPageSize() }, scope);
  };
}
