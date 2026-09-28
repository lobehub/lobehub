import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import { useEffect } from 'react';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { type DisplayContextMemory } from '@/database/repositories/userMemory';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { isMemoryListRequestCurrent } from '../utils/isMemoryListRequestCurrent';
import { shouldSurfaceMemoryListError } from '../utils/shouldSurfaceMemoryListError';

const n = setNamespace('userMemory/context');

export interface ContextQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'capturedAt' | 'scoreImpact' | 'scoreUrgency';
}

type ContextListRequest = ContextQueryParams & { page: number };

type Setter = StoreSetter<UserMemoryStore>;
export const createContextSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ContextActionImpl(set, get, _api);

export class ContextActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  deleteContext = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteContext(id);
    // Reset list to refresh
    this.#get().resetContextsList({ q: this.#get().contextsQuery, sort: this.#get().contextsSort });
  };

  loadMoreContexts = (): void => {
    const { contextsPage, contextsTotal, contexts } = this.#get();
    if (contexts.length < (contextsTotal || 0)) {
      this.#set(
        produce((draft) => {
          draft.contextsPage = contextsPage + 1;
        }),
        false,
        n('loadMoreContexts'),
      );
    }
  };

  internal_acceptContextsList = (data: any, request: ContextListRequest): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        { page: state.contextsPage, q: state.contextsQuery, sort: state.contextsSort },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    this.#set(
      produce((draft) => {
        draft.contextsSearchError = undefined;
        draft.contextsSearchLoading = false;
        draft.contextsInit = true;
        draft.contextsTotal = data.total;

        const transformedItems: DisplayContextMemory[] = data.items.map((item: any) => ({
          ...item.memory,
          ...item.context,
          source: null,
        }));

        if (request.page === 1) {
          draft.contexts = uniqBy(transformedItems, 'id');
        } else {
          draft.contexts = uniqBy([...draft.contexts, ...transformedItems], 'id');
        }

        draft.contextsHasMore = data.items.length >= (request.pageSize || 20);
      }),
      false,
      n('internal_acceptContextsList'),
    );
  };

  internal_failContextsList = (error: unknown, request: ContextListRequest): void => {
    const state = this.#get();
    if (
      !isMemoryListRequestCurrent(
        { page: state.contextsPage, q: state.contextsQuery, sort: state.contextsSort },
        { page: request.page, q: request.q, sort: request.sort },
      )
    )
      return;

    const shouldSurfaceError = shouldSurfaceMemoryListError({
      initialized: state.contextsInit,
      page: request.page,
      resetting: state.contextsSearchLoading,
    });

    this.#set(
      produce((draft) => {
        if (shouldSurfaceError) draft.contextsSearchError = error;
        draft.contextsSearchLoading = false;
      }),
      false,
      n('internal_failContextsList'),
    );
  };

  resetContextsList = (params?: Omit<ContextQueryParams, 'page' | 'pageSize'>): void => {
    this.#set(
      produce((draft) => {
        draft.contexts = [];
        draft.contextsPage = 1;
        draft.contextsQuery = params?.q;
        draft.contextsSearchError = undefined;
        draft.contextsSearchLoading = true;
        draft.contextsSort = params?.sort;
      }),
      false,
      n('resetContextsList'),
    );
  };

  /**
   * Hydrate the store from SWR's rendered state because deduped cache hits do not invoke SWR's
   * request lifecycle callbacks.
   */
  useFetchContexts = (params: ContextQueryParams): SWRResponse<any> => {
    const page = params.page ?? 1;
    const response = useSWR(
      userMemoryKeys.contexts(params),
      async () => {
        const result = await userMemoryService.queryMemories({
          layer: LayersEnum.Context,
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          sort: params.sort,
        });

        return result;
      },
      {
        revalidateOnFocus: false,
      },
    );

    useEffect(() => {
      if (response.data !== undefined)
        this.internal_acceptContextsList(response.data, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.data]);

    useEffect(() => {
      if (response.error !== undefined)
        this.internal_failContextsList(response.error, { ...params, page });
    }, [page, params.pageSize, params.q, params.sort, response.error]);

    return response;
  };
}

export type ContextAction = Pick<ContextActionImpl, keyof ContextActionImpl>;
