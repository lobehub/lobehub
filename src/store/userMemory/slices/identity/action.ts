import {
  type IdentityListResult,
  type NewUserMemoryIdentity,
  type UpdateUserMemoryIdentity,
} from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { type AddIdentityEntryResult } from '@/database/models/userMemory';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';

const n = setNamespace('userMemory/identity');

export interface IdentityQueryParams {
  page?: number;
  pageSize?: number;
  q?: string;
  relationships?: string[];
  sort?: 'capturedAt' | 'type';
  types?: string[];
}

export interface IdentityAction {
  createIdentity: (data: NewUserMemoryIdentity) => Promise<AddIdentityEntryResult>;
  deleteIdentity: (id: string) => Promise<void>;
  loadMoreIdentities: () => void;
  resetIdentitiesList: (params?: Omit<IdentityQueryParams, 'page' | 'pageSize'>) => void;
  updateIdentity: (id: string, data: UpdateUserMemoryIdentity) => Promise<boolean>;
  useFetchIdentities: (params: IdentityQueryParams) => SWRResponse<IdentityListResult>;
}

export const createIdentitySlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  IdentityAction
> = (set, get) => ({
  createIdentity: async (data) => {
    const result = await memoryCRUDService.createIdentity(data);
    // Reset list to refresh
    get().resetIdentitiesList({
      q: get().identitiesQuery,
      relationships: get().identitiesRelationships,
      sort: get().identitiesSort,
      types: get().identitiesTypes,
    });
    return result;
  },

  deleteIdentity: async (id) => {
    await memoryCRUDService.deleteIdentity(id);
    // Reset list to refresh
    get().resetIdentitiesList({
      q: get().identitiesQuery,
      relationships: get().identitiesRelationships,
      sort: get().identitiesSort,
      types: get().identitiesTypes,
    });
  },

  loadMoreIdentities: () => {
    const { identitiesPage, identitiesTotal, identities } = get();
    if (identities.length < (identitiesTotal || 0)) {
      set(
        produce((draft) => {
          draft.identitiesPage = identitiesPage + 1;
        }),
        false,
        n('loadMoreIdentities'),
      );
    }
  },

  resetIdentitiesList: (params) => {
    set(
      produce((draft) => {
        draft.identities = [];
        draft.identitiesPage = 1;
        draft.identitiesQuery = params?.q;
        draft.identitiesRelationships = params?.relationships;
        draft.identitiesSearchLoading = true;
        draft.identitiesSort = params?.sort;
        draft.identitiesTypes = params?.types;
      }),
      false,
      n('resetIdentitiesList'),
    );
  },

  updateIdentity: async (id, data) => {
    const result = await memoryCRUDService.updateIdentity(id, data);
    // Reset list to refresh
    get().resetIdentitiesList({
      q: get().identitiesQuery,
      relationships: get().identitiesRelationships,
      sort: get().identitiesSort,
      types: get().identitiesTypes,
    });
    return result;
  },

  useFetchIdentities: (params) => {
    const swrKeyParts = [
      'useFetchIdentities',
      params.page,
      params.pageSize,
      params.q,
      params.relationships?.join(','),
      params.sort,
      params.types?.join(','),
    ];
    const swrKey = swrKeyParts
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join('-');
    const page = params.page ?? 1;

    return useSWR(
      swrKey,
      async () => {
        // Use the new dedicated queryIdentities API
        return userMemoryService.queryIdentities({
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          relationships: params.relationships,
          sort: params.sort,
          types: params.types,
        });
      },
      {
        onSuccess(data: IdentityListResult) {
          set(
            produce((draft) => {
              draft.identitiesSearchLoading = false;
              draft.identitiesTotal = data.total;

              if (!draft.identitiesInit) {
                draft.identitiesInit = true;
              }

              // Backend now returns flat structure directly, no transformation needed
              if (page === 1) {
                draft.identities = uniqBy(data.items, 'id');
              } else {
                draft.identities = uniqBy([...draft.identities, ...data.items], 'id');
              }

              draft.identitiesHasMore = data.items.length >= (params.pageSize || 20);
            }),
            false,
            n('useFetchIdentities/onSuccess'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  },
});
