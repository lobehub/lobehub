import {
  type IdentityListItem,
  type NewUserMemoryIdentity,
  type UpdateUserMemoryIdentity,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { useLayoutEffect } from 'react';

import { type AddIdentityEntryResult } from '@/database/models/userMemory';
import {
  createReplicaSlice,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { memoryCRUDService } from '@/services/userMemory';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type UserMemoryStore } from '../../store';
import { type IdentityForInjection } from '../../types';
import { clearReplicas, clearUserReplicas, memoryListKey } from '../../utils/replica';
import { OffsetListPager } from '../utils/offsetListPager';
import {
  DEFAULT_IDENTITY_LIST_PAGE_SIZE,
  GLOBAL_IDENTITIES_KEY,
  globalIdentitiesResource,
  type IdentityListParams,
  identityListResource,
  type IdentityListView,
} from './projection';

const n = setNamespace('userMemory/identity');

const GLOBAL_IDENTITIES_PARAMS = {} as Record<string, never>;

const identityEntries = recordLens<UserMemoryStore, IdentityListView>('identityListEntries');

/**
 * Flat mirrors of one identity page set (`undefined` = the active query has no
 * view yet). `identitiesInit` is only ever set here: it survives a query
 * change, so the page controls are not torn down while a search resolves.
 */
const identityMirrorsOf = (data: IdentityListView | undefined): Partial<UserMemoryStore> => {
  if (!data) return { identities: [], identitiesMeta: undefined };
  const { items, ...meta } = data;
  return { identities: items, identitiesInit: true, identitiesMeta: meta };
};

/**
 * The canonical value is one page set per search / filter / sort
 * (`identityListEntries`). The long-standing flat array (`identities`) and its
 * paging bookkeeping (`identitiesMeta`) mirror the active query's entry in the
 * same commit, so every existing reader (grid, timeline, card dropdown, route
 * boundary) keeps reading the same place.
 */
const identityListLens: ReplicaLens<UserMemoryStore, IdentityListView> = {
  clear: (state) => ({
    ...identityEntries.clear(state),
    identities: [],
    identitiesInit: false,
    identitiesMeta: undefined,
  }),
  get: identityEntries.get,
  keys: identityEntries.keys,
  set: (state, key, data) => ({
    ...identityEntries.set(state, key, data),
    ...(key === state.identityListKey ? identityMirrorsOf(data) : undefined),
  }),
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
  readonly #get: () => UserMemoryStore;
  /** Delete / load more / purge with the offset repair shared by every memory list. */
  readonly #pager: OffsetListPager;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserMemoryStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
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
    this.#pager = new OffsetListPager({
      keys: () => Object.keys(get().identityListEntries),
      read: (key) => get().identityListEntries[key],
      refreshHead: () => this.refreshIdentities(),
      scope: () => identityListResource.scope.get(),
      slice: this.#identities,
    });
  }

  createIdentity = async (data: NewUserMemoryIdentity): Promise<AddIdentityEntryResult> => {
    const result = await memoryCRUDService.createIdentity(data);
    await this.refreshIdentities();
    return result;
  };

  /**
   * Delete one identity: optimistic (rolled back if the server rejects), then
   * the offset repair shared by every memory list — the row leaves every
   * persisted search/filter variant, the list collapses to a refreshed head,
   * and "load more" waits for that head (see `OffsetListPager`).
   */
  deleteIdentity = (id: string): Promise<void> =>
    this.#pager.delete(id, () => memoryCRUDService.deleteIdentity(id));

  /** Append the next page of the identities list, once its head is trustworthy. */
  loadMoreIdentities = (): Promise<void> => this.#pager.loadMore(this.#get().identityListKey);

  /**
   * Point the flat mirrors at another search / filter. Each query keeps its own
   * entry, so this drops no page set: a query loaded before repaints from
   * memory, one persisted before hydrates from storage, and a new one shows the
   * loading state until its head lands. A no-op when the query is unchanged.
   */
  #selectQuery = (key: string): void => {
    const state = this.#get();
    if (state.identityListKey === key) return;
    this.#set(
      { identityListKey: key, ...identityMirrorsOf(state.identityListEntries[key]) },
      false,
      n('identities/select'),
    );
  };

  /**
   * Apply a confirmed edit to one identity (an inline edit elsewhere in the
   * store) in every loaded list entry and its persisted rows, so the replica
   * value — not only the view — carries it across a reload.
   */
  internal_updateIdentityEntity = (
    id: string,
    fn: (item: IdentityListItem) => IdentityListItem | undefined,
  ): void => {
    this.#identities.updateEntity(id, fn);
  };

  /**
   * Revalidate the identity replicas of the active scope: the list and the
   * self identities injected into the chat context, which any identity write
   * can change. The replica scope carries the user + workspace, so this always
   * refreshes the lists the caller is in.
   */
  refreshIdentities = async (): Promise<void> => {
    await Promise.all([this.#identities.revalidate(), this.#globalIdentities.revalidate()]);
  };

  /**
   * Wipe every identity replica (list + injection) through the engine: memory,
   * every persisted search/filter variant (not only the query on screen) and
   * reads in flight. Used by the memory purge; `clear()` does not refetch, so
   * the caller revalidates afterwards (`refreshIdentities`). Resolves `true`
   * once the persisted rows are gone.
   */
  internal_clearIdentityList = (user?: string): Promise<boolean> =>
    user === undefined || user === identityListResource.scope.get()
      ? this.#pager.clear(() => clearReplicas(this.#identities.clear, this.#globalIdentities.clear))
      : clearUserReplicas(user, this.#identities, this.#globalIdentities);

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
  useFetchIdentities = (params: IdentityListParams): ReplicaSyncResult => {
    const key = memoryListKey(params);

    // Select the query before paint, so a frame never shows another query's rows.
    useLayoutEffect(() => {
      this.#selectQuery(key);
    }, [key]);

    return this.#identities.useSync(params, {
      ...this.#pager.syncCallbacks(key),
      revalidateOnFocus: false,
    });
  };

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
    params: IdentityListParams = { pageSize: DEFAULT_IDENTITY_LIST_PAGE_SIZE },
  ): Promise<boolean> => {
    const scope = identityListResource.scope.get();
    this.#identities.ensureScope(scope);

    return this.#identities.hydrate(params, scope);
  };
}

export type IdentityAction = Pick<IdentityActionImpl, keyof IdentityActionImpl>;
