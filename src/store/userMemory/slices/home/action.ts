import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { useClientDataSWR } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';

import { type PersonaData } from '../../initialState';
import type { UserMemoryStore } from '../../store';

const FETCH_TAGS_KEY = 'useFetchTags';
const FETCH_PERSONA_KEY = 'useFetchPersona';
const n = (namespace: string) => namespace;

export interface HomeAction {
  useFetchPersona: () => SWRResponse<PersonaData | null>;
  useFetchTags: () => SWRResponse<QueryIdentityRolesResult>;
}

export const createHomeSlice: StateCreator<
  UserMemoryStore,
  [['zustand/devtools', never]],
  [],
  HomeAction
> = (set) => ({
  useFetchPersona: () =>
    useClientDataSWR(FETCH_PERSONA_KEY, () => userMemoryService.getPersona(), {
      onSuccess: (data: PersonaData | null | undefined) => {
        set(
          {
            persona: data ?? undefined,
            personaInit: true,
          },
          false,
          n('useFetchPersona/onSuccess'),
        );
      },
    }),

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
