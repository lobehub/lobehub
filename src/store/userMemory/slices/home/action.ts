import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { useClientDataSWR } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';

import type { UserMemoryStore } from '../../store';

const FETCH_TAGS_KEY = 'useFetchTags';
const n = (namespace: string) => namespace;

export interface HomeAction {
  useFetchTags: () => SWRResponse<QueryIdentityRolesResult>;
}

export const createHomeSlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  HomeAction
> = (set) => ({
  useFetchTags: () =>
    useClientDataSWR(
      FETCH_TAGS_KEY,
      () =>
        userMemoryService.queryIdentityRoles({
          page: 1,
          size: 64,
        }),
      {
        onSuccess: (data: QueryIdentityRolesResult | undefined) => {
          set(
            {
              roles: data?.roles.map((item) => ({ count: item.count, tag: item.role })) || [],
              tags: data?.tags || [],
              tagsInit: true,
            },
            false,
            n('useFetchTags/onSuccess'),
          );
        },
      },
    ),
});
