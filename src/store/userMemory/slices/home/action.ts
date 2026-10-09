import { type SWRResponse } from 'swr';

import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';

import { type PersonaData } from '../../initialState';
import { type UserMemoryStore } from '../../store';

const n = (namespace: string) => namespace;

type Setter = StoreSetter<UserMemoryStore>;
export const createHomeSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new HomeActionImpl(set, get, _api);

export class HomeActionImpl {
  readonly #set: Setter;
  readonly #get: () => UserMemoryStore;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * Load the persona on demand, for callers that need it *now* instead of on the
   * next mount.
   *
   * `useFetchPersona` covers the surfaces that mount a conversation, but the
   * message context is built from the store and reads the persona
   * synchronously (`resolveUserPersona` never fetches). A Home submission that
   * happens before any conversation mounted would otherwise run its first turn
   * without the persona the user enabled.
   *
   * A failed load leaves `personaInit` false so the next attempt retries, and
   * the caller proceeds without a persona — the same degradation as an
   * unloaded cache.
   */
  ensurePersona = async (): Promise<void> => {
    if (this.#get().personaInit) return;

    try {
      const data = await userMemoryService.getPersona();

      this.#set({ persona: data ?? undefined, personaInit: true }, false, n('ensurePersona'));
      // Seed the key the SWR surfaces read, so a conversation mounting right
      // after this reuses the document instead of fetching it a second time.
      await mutate(userMemoryKeys.persona(), data ?? null, { revalidate: false });
    } catch (error) {
      console.warn('[userMemory] failed to load the persona on demand:', error);
    }
  };

  useFetchPersona = (isLogin = true): SWRResponse<PersonaData | null> => {
    return useClientDataSWR(
      isLogin ? userMemoryKeys.persona() : null,
      () => userMemoryService.getPersona(),
      {
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
      },
    );
  };

  useFetchTags = (): SWRResponse<QueryIdentityRolesResult> => {
    return useClientDataSWR(
      userMemoryKeys.tags(),
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
