import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import { type KnowledgeBaseStore } from '@/store/knowledgeBase/store';
import { type CreateKnowledgeBaseParams, type KnowledgeBaseItem } from '@/types/knowledgeBase';

const FETCH_KNOWLEDGE_BASE_LIST_KEY = 'FETCH_KNOWLEDGE_BASE';
const FETCH_KNOWLEDGE_BASE_ITEM_KEY = 'FETCH_KNOWLEDGE_BASE_ITEM';

export interface KnowledgeBaseCrudAction {
  createNewKnowledgeBase: (params: CreateKnowledgeBaseParams) => Promise<string>;
  internal_toggleKnowledgeBaseLoading: (id: string, loading: boolean) => void;
  refreshKnowledgeBaseList: () => Promise<void>;

  removeKnowledgeBase: (id: string) => Promise<void>;
  updateKnowledgeBase: (id: string, value: CreateKnowledgeBaseParams) => Promise<void>;

  useFetchKnowledgeBaseItem: (id: string) => SWRResponse<KnowledgeBaseItem | undefined>;
  useFetchKnowledgeBaseList: (params?: { suspense?: boolean }) => SWRResponse<KnowledgeBaseItem[]>;
}

export const createCrudSlice: StateCreator<
  KnowledgeBaseStore,
  [['zustand/devtools', never]],
  [],
  KnowledgeBaseCrudAction
> = (set, get) => ({
  createNewKnowledgeBase: async (params) => {
    const id = await knowledgeBaseService.createKnowledgeBase(params);

    await get().refreshKnowledgeBaseList();

    return id;
  },
  internal_toggleKnowledgeBaseLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) return { knowledgeBaseLoadingIds: [...state.knowledgeBaseLoadingIds, id] };

        return { knowledgeBaseLoadingIds: state.knowledgeBaseLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleKnowledgeBaseLoading',
    );
  },
  refreshKnowledgeBaseList: async () => {
    await mutate(FETCH_KNOWLEDGE_BASE_LIST_KEY);
  },
  removeKnowledgeBase: async (id) => {
    await knowledgeBaseService.deleteKnowledgeBase(id);
    await get().refreshKnowledgeBaseList();
  },
  updateKnowledgeBase: async (id, value) => {
    get().internal_toggleKnowledgeBaseLoading(id, true);
    await knowledgeBaseService.updateKnowledgeBaseList(id, value);
    await get().refreshKnowledgeBaseList();

    get().internal_toggleKnowledgeBaseLoading(id, false);
  },

  useFetchKnowledgeBaseItem: (id) =>
    useClientDataSWR<KnowledgeBaseItem | undefined>(
      [FETCH_KNOWLEDGE_BASE_ITEM_KEY, id],
      () => knowledgeBaseService.getKnowledgeBaseById(id),
      {
        onSuccess: (item) => {
          if (!item) return;

          set({
            activeKnowledgeBaseId: id,
            activeKnowledgeBaseItems: {
              ...get().activeKnowledgeBaseItems,
              [id]: item,
            },
          });
        },
      },
    ),

  useFetchKnowledgeBaseList: (params = {}) =>
    useClientDataSWR<KnowledgeBaseItem[]>(
      FETCH_KNOWLEDGE_BASE_LIST_KEY,
      () => knowledgeBaseService.getKnowledgeBaseList(),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!get().initKnowledgeBaseList)
            set({ initKnowledgeBaseList: true }, false, 'useFetchKnowledgeBaseList/init');
        },
        suspense: params.suspense,
      },
    ),
});
