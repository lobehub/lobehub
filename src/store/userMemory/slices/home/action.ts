import { type SWRResponse } from 'swr';

import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { useClientDataSWR } from '@/libs/swr';
import { userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';

import { type PersonaData } from '../../initialState';
import { type UserMemoryStore } from '../../store';

const FETCH_TAGS_KEY = 'useFetchTags';
const FETCH_PERSONA_KEY = 'useFetchPersona';
const n = (namespace: string) => namespace;

type Setter = StoreSetter<UserMemoryStore>;
export const createHomeSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new HomeActionImpl(set, get, _api);

export class HomeActionImpl {
  readonly #get: () => UserMemoryStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useFetchPersona = (): SWRResponse<PersonaData | null> => {
    return useClientDataSWR(FETCH_PERSONA_KEY, () => userMemoryService.getPersona(), {
      onSuccess: (data: PersonaData | null | undefined) => {
        this.#set(
          {
            persona: data ?? undefined,
            personaInit: true,
          },
          false,
          n('useFetchPersona/onSuccess'),
        );
      },
    });
  };

  useFetchTags = (): SWRResponse<QueryIdentityRolesResult> => {
    return useClientDataSWR(
      FETCH_TAGS_KEY,
      () =>
        userMemoryService.queryIdentityRoles({
          page: 1,
          size: 64,
        }),
      {
        onSuccess: (data: QueryIdentityRolesResult | undefined) => {
          this.#set(
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
    );
  };
}

export type HomeAction = Pick<HomeActionImpl, keyof HomeActionImpl>;
