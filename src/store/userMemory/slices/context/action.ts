import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { userMemoryService } from '@/services/userMemory';
import { memoryCRUDService } from '@/services/userMemory/index';
import { LayersEnum } from '@/types/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/context');

export interface ContextQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: 'scoreImpact' | 'scoreUrgency';
}

export interface ContextAction {
  deleteContext: (id: string) => Promise<void>;
  loadMoreContexts: () => void;
  resetContextsList: (params?: Omit<ContextQueryParams, 'page' | 'pageSize'>) => void;
  useFetchContexts: (params: ContextQueryParams) => SWRResponse<any>;
}

export const createContextSlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  ContextAction
> = (set, get) => ({
  deleteContext: async (id) => {
    await memoryCRUDService.deleteContext(id);
    // Reset list to refresh
    get().resetContextsList({ q: get().contextsQuery, sort: get().contextsSort });
  },

  loadMoreContexts: () => {
    const { contextsPage, contextsTotal, contexts } = get();
    if (contexts.length < (contextsTotal || 0)) {
      set(
        produce((draft) => {
          draft.contextsPage = contextsPage + 1;
        }),
        false,
        n('loadMoreContexts'),
      );
    }
  },

  resetContextsList: (params) => {
    set(
      produce((draft) => {
        draft.contexts = [];
        draft.contextsPage = 1;
        draft.contextsQuery = params?.q;
        draft.contextsSearchLoading = true;
        draft.contextsSort = params?.sort;
      }),
      false,
      n('resetContextsList'),
    );
  },

  useFetchContexts: (params) => {
    const swrKeyParts = ['useFetchContexts', params.page, params.pageSize, params.q, params.sort];
    const swrKey = swrKeyParts
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join('-');
    const page = params.page ?? 1;

    return useSWR(
      swrKey,
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
        onSuccess(data: any) {
          set(
            produce((draft) => {
              draft.contextsSearchLoading = false;

              // 设置基础信息
              if (!draft.contextsInit) {
                draft.contextsInit = true;
                draft.contextsTotal = data.total;
              }

              // 转换数据结构
              const transformedItems = data.items.map((item: any) => ({
                ...item.memory,
                ...item.context,
                source: null,
              }));

              // 累积数据逻辑
              if (page === 1) {
                // 第一页，直接设置
                draft.contexts = uniqBy(transformedItems, 'id');
              } else {
                // 后续页面，累积数据
                draft.contexts = uniqBy([...draft.contexts, ...transformedItems], 'id');
              }

              // 更新 hasMore
              draft.contextsHasMore = data.items.length >= (params.pageSize || 20);
            }),
            false,
            n('useFetchContexts/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});
