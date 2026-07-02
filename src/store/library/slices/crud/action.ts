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
    // The KB list is keyed by (workspaceId, visibility?), so we invalidate the
    // three surfaces that can be currently rendered — unscoped, private-only,
    // workspace-only — to keep both modes in sync after a mutation.
    await Promise.all([
      mutate(knowledgeBaseKeys.list(workspaceId)),
      mutate(knowledgeBaseKeys.list(workspaceId, 'private')),
      mutate(knowledgeBaseKeys.list(workspaceId, 'public')),
    ]);
  };

  removeKnowledgeBase = async (id: string): Promise<void> => {
    await knowledgeBaseService.deleteKnowledgeBase(id);
    await this.#get().refreshKnowledgeBaseList();
  };

  publishKnowledgeBaseToWorkspace = async (id: string): Promise<void> => {
    await knowledgeBaseService.publishKnowledgeBaseToWorkspace(id);
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
    visibility?: 'private' | 'public',
  ): SWRResponse<KnowledgeBaseItem[]> => {
    const workspaceId = getActiveWorkspaceId();
    return useClientDataSWR<KnowledgeBaseItem[]>(
      knowledgeBaseKeys.list(workspaceId, visibility),
      () => knowledgeBaseService.getKnowledgeBaseList(visibility),
      {
        fallbackData: [],
        onSuccess: () => {
          if (!this.#get().initKnowledgeBaseList)
            this.#set({ initKnowledgeBaseList: true }, false, 'useFetchKnowledgeBaseList/init');
        },
      },
    );
  };
}

export type KnowledgeBaseCrudAction = Pick<
  KnowledgeBaseCrudActionImpl,
  keyof KnowledgeBaseCrudActionImpl
>;
