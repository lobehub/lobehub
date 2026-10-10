import {
  type IdentityListItem,
  type NewUserMemoryIdentity,
  type UpdateUserMemoryIdentity,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import { type AddIdentityEntryResult } from '@/database/models/userMemory';
import {
  cacheScope,
  createReplicaSlice,
  mapPagedItem,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { memoryCRUDService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { type IdentityForInjection } from '../../types';
import {
  DEFAULT_IDENTITY_LIST_PAGE_SIZE,
  GLOBAL_IDENTITIES_KEY,
  globalIdentitiesResource,
  IDENTITY_LIST_KEY,
  type IdentityListParams,
  identityListResource,
  type IdentityListView,
} from './projection';

const n = setNamespace('userMemory/identity');

const GLOBAL_IDENTITIES_PARAMS = {} as Record<string, never>;

/** Paging identity of the list, for the row helpers below. */
const IDENTITY_PAGING = { getId: (item: IdentityListItem) => item.id };

/**
 * The identities list keeps its long-standing flat array (`identities`) as the
 * replica view, with the paging bookkeeping beside it in `identitiesMeta` — so
 * every existing reader (grid, timeline, card dropdown) keeps reading the same
 * place. `identitiesInit` is written with the first landing page and survives a
 * query change, so the page controls are not torn down while a search resolves.
 */
const identityListLens: ReplicaLens<UserMemoryStore, IdentityListView> = {
  clear: () => ({ identities: [], identitiesInit: false, identitiesMeta: undefined }),
  get: (state) =>
    state.identitiesMeta ? { ...state.identitiesMeta, items: state.identities } : undefined,
  keys: (state) => (state.identitiesMeta ? [IDENTITY_LIST_KEY] : []),
  set: (_state, _key, data) => {
    if (!data) return { identities: [], identitiesMeta: undefined };
    const { items, ...meta } = data;
    return { identities: items, identitiesInit: true, identitiesMeta: meta };
  },
};

/** Single-slot view of the injection-identities replica. */
const globalIdentitiesLens: ReplicaLens<UserMemoryStore, IdentityForInjection[]> = {
  clear: () => ({ globalIdentities: [], globalIdentitiesInit: false }),
  get: (state) => (state.globalIdentitiesInit ? state.globalIdentities : undefined),
  keys: (state) => (state.globalIdentitiesInit ? [GLOBAL_IDENTITIES_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { globalIdentities: data, globalIdentitiesInit: true }
      : { globalIdentities: [], globalIdentitiesInit: false },
};

type Setter = StoreSetter<UserMemoryStore>;
export const createIdentitySlice = (set: Setter, get: () => UserMemoryStore, _api?: unknown) =>
  new IdentityActionImpl(set, get, _api);

/**
 * The identities domain.
 *
 * Server state is two replicas: the paginated `identities` list (its flat array
 * is `identities`, its paging bookkeeping `identitiesMeta`) and the
 * `globalIdentities` injection list. Each paints its persisted copy on the
 * first frame and is confirmed by the network in the background; the engine
 * owns hydration, paging, optimistic overlays with rollback and scope
 * isolation.
 */
export class IdentityActionImpl {
  readonly #globalIdentities;
  /** The identity list is a paged replica; the engine owns its paging. */
  readonly #identities;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#identities = createReplicaSlice(identityListResource, {
      actionPrefix: n('identities'),
      get,
      set,
      stateKey: 'identitiesReplica',
      view: identityListLens,
      viewFields: ({ order, q, relationships, sort, types }) => ({
        order,
        q: q || undefined,
        relationships,
        sort,
        types,
      }),
    });
    this.#globalIdentities = createReplicaSlice(globalIdentitiesResource, {
      actionPrefix: n('globalIdentities'),
      get,
      // An unchanged list must not re-render the injection consumers.
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'globalIdentitiesReplica',
      view: globalIdentitiesLens,
    });
  }

  createIdentity = async (data: NewUserMemoryIdentity): Promise<AddIdentityEntryResult> => {
    const result = await memoryCRUDService.createIdentity(data);
    await this.refreshIdentities();
    return result;
  };

  /**
   * Delete one identity. The row leaves the list immediately (a failed call
   * rolls it back), then the head page is revalidated so the persisted copy
   * matches the server.
   */
  deleteIdentity = async (id: string): Promise<void> => {
    await this.#identities.optimistic(
      IDENTITY_LIST_KEY,
      (data) =>
        mapPagedItem<IdentityListItem, number, IdentityListView>(
          data,
          id,
          () => undefined,
          IDENTITY_PAGING,
        ),
      () => memoryCRUDService.deleteIdentity(id),
      { revalidate: true },
    );
  };

  /**
   * Append the next page of the identities list. The engine reads the loaded
   * head params and de-dupes by id, so a shifted offset never repeats a row.
   */
  loadMoreIdentities = async (): Promise<void> => {
    await this.#identities.loadMore(IDENTITY_LIST_KEY);
  };

  /**
   * Patch one row in the list view in place (an inline edit elsewhere in the
   * store). Goes through the replica so the persisted copy and any other holder
   * of the entity stay in step.
   */
  patchIdentityInList = (id: string, patch: Partial<IdentityListItem>): void => {
    this.#identities.update(IDENTITY_LIST_KEY, (data) =>
      data
        ? mapPagedItem<IdentityListItem, number, IdentityListView>(
            data,
            id,
            (item) => ({ ...item, ...patch }),
            IDENTITY_PAGING,
          )
        : data,
    );
  };

  /**
   * Revalidate the identities list of the active scope. The replica scope
   * carries the user + workspace, so this always refreshes the list the caller
   * is in.
   */
  refreshIdentities = async (): Promise<void> => {
    await this.#identities.revalidate();
  };

  /**
   * Drop every identity replica (list + injection) and its persisted copies.
   * Used by the memory purge: the views must go through the engine, not be
   * overwritten by an `initialState` assignment.
   */
  resetIdentities = (): void => {
    this.#identities.remove(IDENTITY_LIST_KEY);
    this.#globalIdentities.remove(GLOBAL_IDENTITIES_KEY);
  };

  updateIdentity = async (id: string, data: UpdateUserMemoryIdentity): Promise<boolean> => {
    const result = await memoryCRUDService.updateIdentity(id, data);
    await this.refreshIdentities();
    return result;
  };

  /**
   * Fetch orchestration for the identities list. Hydrates the persisted head
   * page, then revalidates; the rows land in `identities` — read them from the
   * store, never from this hook.
   */
  useFetchIdentities = (params: IdentityListParams): ReplicaSyncResult =>
    this.#identities.useSync(params, { revalidateOnFocus: false });

  /**
   * Fetch orchestration for the self identities injected into the chat context.
   * Signed-out callers disable the sync, matching the previous `null` key.
   */
  useInitIdentities = (isLogin: boolean): ReplicaSyncResult =>
    this.#globalIdentities.useSync(GLOBAL_IDENTITIES_PARAMS, { enabled: isLogin === true });

  /**
   * Seed the persisted head page of the identities list before the route
   * commits, so a cold start paints the local copy instead of a skeleton. A
   * later `useSync` hydrate is a no-op once the slot is filled.
   */
  preHydrateIdentities = (
    params: Pick<IdentityListParams, 'pageSize'> = { pageSize: DEFAULT_IDENTITY_LIST_PAGE_SIZE },
  ): Promise<boolean> => {
    const scope = cacheScope.get();
    this.#identities.ensureScope(scope);

    return this.#identities.hydrate(params, scope);
  };
}

export type IdentityAction = Pick<IdentityActionImpl, keyof IdentityActionImpl>;
