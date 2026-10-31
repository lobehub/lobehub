import { type MemoryContextStory, type MemoryContextStoryList } from '@lobechat/types';
import { type SWRResponse } from 'swr';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { memoryCRUDService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/contextStory');

type Setter = StoreSetter<UserMemoryStore>;
export const createContextStorySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new ContextStoryActionImpl(set, get, _api);

/** Consolidated contexts (context → dossiers → evidence), read-only for now. */
export class ContextStoryActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshContextStories = async (): Promise<void> => {
    await mutate(userMemoryKeys.contextStories());
  };

  useFetchContextStories = (): SWRResponse<MemoryContextStoryList> =>
    useClientDataSWR(userMemoryKeys.contextStories(), () => memoryCRUDService.getContextStories(), {
      onSuccess: (data: MemoryContextStoryList) => {
        this.#set({ contextStoryList: data }, false, n('useFetchContextStories/onSuccess'));
      },
    });

  useFetchContextStory = (id?: string): SWRResponse<MemoryContextStory | null> =>
    useClientDataSWR(
      id ? userMemoryKeys.contextStory(id) : null,
      () => memoryCRUDService.getContextStory(id!),
      {
        onSuccess: (data: MemoryContextStory | null) => {
          if (!id) return;
          this.#set(
            { contextStoryMap: { ...this.#get().contextStoryMap, [id]: data } },
            false,
            n('useFetchContextStory/onSuccess'),
          );
        },
      },
    );
}

export type ContextStoryAction = Pick<ContextStoryActionImpl, keyof ContextStoryActionImpl>;
