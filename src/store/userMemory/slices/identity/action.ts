import {
  type IdentityListResult,
  type NewUserMemoryIdentity,
  type UpdateUserMemoryIdentity,
} from '@lobechat/types';
import { uniqBy } from 'es-toolkit/compat';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { type AddIdentityEntryResult } from '@/database/models/userMemory';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
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

type Setter = StoreSetter<UserMemoryStore>;
export const createIdentitySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new IdentityActionImpl(set, get, _api);

export class IdentityActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createIdentity = async (data: NewUserMemoryIdentity): Promise<AddIdentityEntryResult> => {
    const result = await memoryCRUDService.createIdentity(data);
    // Reset list to refresh
    this.#get().resetIdentitiesList({
      q: this.#get().identitiesQuery,
      relationships: this.#get().identitiesRelationships,
      sort: this.#get().identitiesSort,
      types: this.#get().identitiesTypes,
    });
    return result;
  };

  deleteIdentity = async (id: string): Promise<void> => {
    await memoryCRUDService.deleteIdentity(id);
    // Reset list to refresh
    this.#get().resetIdentitiesList({
      q: this.#get().identitiesQuery,
      relationships: this.#get().identitiesRelationships,
      sort: this.#get().identitiesSort,
      types: this.#get().identitiesTypes,
    });
  };

  loadMoreIdentities = (): void => {
    const { identitiesPage, identitiesTotal, identities } = this.#get();
    if (identities.length < (identitiesTotal || 0)) {
      this.#set(
        produce((draft) => {
          draft.identitiesPage = identitiesPage + 1;
        }),
        false,
        n('loadMoreIdentities'),
      );
    }
  };

  resetIdentitiesList = (params?: Omit<IdentityQueryParams, 'page' | 'pageSize'>): void => {
    this.#set(
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
  };

  updateIdentity = async (id: string, data: UpdateUserMemoryIdentity): Promise<boolean> => {
    const result = await memoryCRUDService.updateIdentity(id, data);
    // Reset list to refresh
    this.#get().resetIdentitiesList({
      q: this.#get().identitiesQuery,
      relationships: this.#get().identitiesRelationships,
      sort: this.#get().identitiesSort,
      types: this.#get().identitiesTypes,
    });
    return result;
  };

  useFetchIdentities = (params: IdentityQueryParams): SWRResponse<IdentityListResult> => {
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
        onSuccess: (data: IdentityListResult) => {
          this.#set(
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
  };
}

export type IdentityAction = Pick<IdentityActionImpl, keyof IdentityActionImpl>;
