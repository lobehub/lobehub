import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';
import { type SWRResponse } from 'swr';

import { type QueryIdentityRolesResult } from '@/database/models/userMemory';
import { createReplicaSlice, type ReplicaLens } from '@/libs/replica';
import { mutate } from '@/libs/swr';
import { userMemoryKeys } from '@/libs/swr/keys';
import { userMemoryService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore, useUserMemoryStore } from '../../store';
import {
  type HomeReplicaParams,
  IDENTITY_ROLES_KEY,
  IDENTITY_ROLES_QUERY,
  type IdentityRolesData,
  identityRolesResource,
  PERSONA_KEY,
  type PersonaData,
  type PersonaReplicaData,
  personaResource,
} from './projection';

const n = setNamespace('userMemory/home');

/** Both home resources are one fixed entry per scope. */
const HOME_PARAMS: HomeReplicaParams = {};

/**
 * The persona keeps its long-standing flat fields (`persona`, `personaInit`) as
 * derived mirrors of the `personaData` replica view, so no consumer changes.
 * The canonical value lives in `personaData` and is persisted to IndexedDB by
 * the replica engine.
 */
const personaLens: ReplicaLens<UserMemoryStore, PersonaReplicaData> = {
  clear: () => ({ persona: undefined, personaData: undefined, personaInit: false }),
  get: (state) => state.personaData,
  keys: (state) => (state.personaData ? [PERSONA_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { persona: data.persona ?? undefined, personaData: data, personaInit: true }
      : { persona: undefined, personaData: undefined, personaInit: false },
};

/**
 * The identity roles + tags aggregate keeps its long-standing flat fields
 * (`roles`, `tags`, `tagsInit`) as derived mirrors of the `identityRolesData`
 * replica view, so no consumer changes. The server field `role` is renamed to
 * `tag` for `roles`, exactly as the previous slice did.
 */
const identityRolesLens: ReplicaLens<UserMemoryStore, IdentityRolesData> = {
  clear: () => ({ identityRolesData: undefined, roles: [], tags: [], tagsInit: false }),
  get: (state) => state.identityRolesData,
  keys: (state) => (state.identityRolesData ? [IDENTITY_ROLES_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? {
          identityRolesData: data,
          roles: data.roles.map((item) => ({ count: item.count, tag: item.role })),
          tags: data.tags,
          tagsInit: true,
        }
      : { identityRolesData: undefined, roles: [], tags: [], tagsInit: false },
};

/** An unchanged response must not repaint its readers. */
const mergeUnchanged = <T>(incoming: T, confirmed: T | undefined) =>
  isEqual(incoming, confirmed) ? undefined : incoming;

type Setter = StoreSetter<UserMemoryStore>;
export const createHomeSlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new HomeActionImpl(set, get, _api);

/**
 * The memory home reads: the persona and the identity roles + tags aggregate.
 *
 * Server state is two `@lobechat/replica` single-value resources (`personaData`
 * and `identityRolesData`): the persisted copy paints on the first frame and
 * the network confirms it in the background. The domain store exposes the same
 * flat fields and the same action surface it always has, backed by the replica
 * views, so the memory home page and its components are untouched.
 */
export class HomeActionImpl {
  readonly #identityRoles;
  readonly #persona;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#persona = createReplicaSlice(personaResource, {
      actionPrefix: n('persona'),
      fetcher: () => this.#fetchPersona(),
      get,
      merge: (incoming, confirmed) => mergeUnchanged(incoming, confirmed),
      set,
      stateKey: 'personaReplica',
      view: personaLens,
    });
    this.#identityRoles = createReplicaSlice(identityRolesResource, {
      actionPrefix: n('identityRoles'),
      fetcher: () => this.#fetchIdentityRoles(),
      get,
      merge: (incoming, confirmed) => mergeUnchanged(incoming, confirmed),
      set,
      stateKey: 'identityRolesReplica',
      view: identityRolesLens,
    });
  }

  #fetchIdentityRoles = async (): Promise<IdentityRolesData> =>
    userMemoryService.queryIdentityRoles({ ...IDENTITY_ROLES_QUERY });

  /** The persona read returns `null` when the user has none; wrap it so the value is never missing. */
  #fetchPersona = async (): Promise<PersonaReplicaData> => ({
    persona: await userMemoryService.getPersona(),
  });

  /**
   * Drop the persona locally, then re-read server truth (now `null`). The
   * persona delete flow calls this so the section disappears immediately
   * instead of waiting for a network round trip.
   */
  refreshPersona = async (): Promise<void> => {
    this.#persona.update(PERSONA_KEY, () => ({ persona: null }), { persist: true });
    // The replica adopts `userMemory:persona` as its sync key, so revalidating
    // that key is what drives the network sync.
    await mutate(userMemoryKeys.persona());
  };

  /**
   * Fetch orchestration for the memory persona. Returns an `SWRResponse`-shaped
   * result — `data` reads the replica view — so the existing consumers are
   * untouched; the value lands in the store mirror, never in this return value.
   */
  useFetchPersona = (isLogin = true): SWRResponse<PersonaData | null> => {
    const sync = this.#persona.useSync(HOME_PARAMS, { enabled: isLogin });
    const view = useUserMemoryStore((state) => state.personaData);
    const data = useMemo<PersonaData | null | undefined>(() => view?.persona, [view]);

    return {
      data,
      error: sync.error,
      isLoading: isLogin && !view && (sync.isValidating || !sync.isHydrated),
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<PersonaData | null>;
  };

  /**
   * Fetch orchestration for the identity roles + tags aggregate. Returns an
   * `SWRResponse`-shaped result so the existing consumers are untouched; the
   * value lands in the store mirrors, never in this return value.
   */
  useFetchTags = (): SWRResponse<QueryIdentityRolesResult> => {
    const sync = this.#identityRoles.useSync(HOME_PARAMS);
    const view = useUserMemoryStore((state) => state.identityRolesData);
    const data = useMemo<IdentityRolesData | undefined>(() => view, [view]);

    return {
      data,
      error: sync.error,
      isLoading: !view && (sync.isValidating || !sync.isHydrated),
      isValidating: sync.isValidating,
      mutate: sync.revalidate,
    } as unknown as SWRResponse<QueryIdentityRolesResult>;
  };
}

export type HomeAction = Pick<HomeActionImpl, keyof HomeActionImpl>;
