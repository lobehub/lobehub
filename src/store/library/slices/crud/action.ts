import type { SWRResponse } from 'swr';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { knowledgeBaseKeys } from '@/libs/swr/keys';
import { knowledgeBaseService } from '@/services/knowledgeBase';
import type { KnowledgeBaseStore } from '@/store/library/store';
import type { StoreSetter } from '@/store/types';
import type { CreateKnowledgeBaseParams, KnowledgeBaseItem } from '@/types/knowledgeBase';

type Setter = StoreSetter<KnowledgeBaseStore>;
export const createCrudSlice = (set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) =>
  new KnowledgeBaseCrudActionImpl(set, get, _api);

export class KnowledgeBaseCrudActionImpl {
  readonly #get: () => KnowledgeBaseStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => KnowledgeBaseStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createNewKnowledgeBase = async (params: CreateKnowledgeBaseParams): Promise<string> => {
    const id = await knowledgeBaseService.createKnowledgeBase(params);

    await this.#get().refreshKnowledgeBaseList();

    return id;
  };

  internal_toggleKnowledgeBaseLoading = (id: string, loading: boolean): void => {
    this.#set(
      (state) => {
        if (loading) return { knowledgeBaseLoadingIds: [...state.knowledgeBaseLoadingIds, id] };

        return { knowledgeBaseLoadingIds: state.knowledgeBaseLoadingIds.filter((i) => i !== id) };
      },
      false,
      'toggleKnowledgeBaseLoading',
    );
  };

  refreshKnowledgeBaseList = async (): Promise<void> => {
    const workspaceId = getActiveWorkspaceId();
    await mutate(knowledgeBaseKeys.list(workspaceId));
  };

  removeKnowledgeBase = async (id: string): Promise<void> => {
    await knowledgeBaseService.deleteKnowledgeBase(id);
    await this.#get().refreshKnowledgeBaseList();
  };

  updateKnowledgeBase = async (id: string, value: CreateKnowledgeBaseParams): Promise<void> => {
    this.#get().internal_toggleKnowledgeBaseLoading(id, true);
    await knowledgeBaseService.updateKnowledgeBaseList(id, value);
    await this.#get().refreshKnowledgeBaseList();

    this.#get().internal_toggleKnowledgeBaseLoading(id, false);
  };

  useFetchKnowledgeBaseItem = (id: string): SWRResponse<KnowledgeBaseItem | undefined> => {
    return useClientDataSWR<KnowledgeBaseItem | undefined>(
      knowledgeBaseKeys.item(id),
      () => knowledgeBaseService.getKnowledgeBaseById(id),
      {
        onSuccess: (item) => {
          if (!item) return;

          this.#set({
            activeKnowledgeBaseId: id,
            activeKnowledgeBaseItems: {
              ...this.#get().activeKnowledgeBaseItems,
              [id]: item,
            },
          });
        },
      },
    );
  };

  useFetchKnowledgeBaseList = (
    params: { suspense?: boolean } = {},
  ): SWRResponse<KnowledgeBaseItem[]> => {
    return useClientDataSWR<KnowledgeBaseItem[]>(
      knowledgeBaseKeys.list(),
      () => knowledgeBaseService.getKnowledgeBaseList(),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!this.#get().initKnowledgeBaseList)
            this.#set({ initKnowledgeBaseList: true }, false, 'useFetchKnowledgeBaseList/init');
        },
        suspense: params.suspense,
      },
    );
  };
}

export type KnowledgeBaseCrudAction = Pick<
  KnowledgeBaseCrudActionImpl,
  keyof KnowledgeBaseCrudActionImpl
>;
