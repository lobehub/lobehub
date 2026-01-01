import {
  LayersEnum,
  type NewUserMemoryIdentity,
  type TypesEnum,
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
  types?: TypesEnum[];
}

export interface IdentityAction {
  createIdentity: (data: NewUserMemoryIdentity) => Promise<AddIdentityEntryResult>;
  deleteIdentity: (id: string) => Promise<void>;
  loadMoreIdentities: () => void;
  resetIdentitiesList: (params?: Omit<IdentityQueryParams, 'page' | 'pageSize'>) => void;
  updateIdentity: (id: string, data: UpdateUserMemoryIdentity) => Promise<boolean>;
  useFetchIdentities: (params: IdentityQueryParams) => SWRResponse<any>;
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
    get().resetIdentitiesList({ q: get().identitiesQuery, types: get().identitiesTypes });
    return result;
  },

  deleteIdentity: async (id) => {
    await memoryCRUDService.deleteIdentity(id);
    // Reset list to refresh
    get().resetIdentitiesList({ q: get().identitiesQuery, types: get().identitiesTypes });
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
        draft.identitiesSearchLoading = true;
        draft.identitiesTypes = params?.types;
      }),
      false,
      n('resetIdentitiesList'),
    );
  },

  updateIdentity: async (id, data) => {
    const result = await memoryCRUDService.updateIdentity(id, data);
    // Reset list to refresh
    get().resetIdentitiesList({ q: get().identitiesQuery, types: get().identitiesTypes });
    return result;
  },

  useFetchIdentities: (params) => {
    const swrKeyParts = [
      'useFetchIdentities',
      params.page,
      params.pageSize,
      params.q,
      params.types?.join(','),
    ];
    const swrKey = swrKeyParts
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join('-');
    const page = params.page ?? 1;

    return useSWR(
      swrKey,
      async () => {
        return await userMemoryService.queryMemories({
          layer: LayersEnum.Identity,
          page: params.page,
          pageSize: params.pageSize,
          q: params.q,
          types: params.types,
        });
      },
      {
        onSuccess(data: any) {
          set(
            produce((draft) => {
              draft.identitiesSearchLoading = false;

              // 设置基础信息
              if (!draft.identitiesInit) {
                draft.identitiesInit = true;
                draft.identitiesTotal = data.total;
              }

              // 转换数据结构
              const transformedItems = data.items.map((item: any) => ({
                ...item.memory,
                ...item.identity,
              }));

              // 累积数据逻辑
              if (page === 1) {
                // 第一页，直接设置
                draft.identities = uniqBy(transformedItems, 'id');
              } else {
                // 后续页面，累积数据
                draft.identities = uniqBy([...draft.identities, ...transformedItems], 'id');
              }

              // 更新 hasMore
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
