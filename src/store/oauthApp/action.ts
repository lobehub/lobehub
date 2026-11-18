import isEqual from 'fast-deep-equal';

import {
  arrayEntity,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { subscribeCacheScope } from '@/libs/replica/cacheScopeEvents';
import { oauthAppService } from '@/services/oauthApp';
import { type StoreSetter } from '@/store/types';
import {
  type CreateOAuthAppParams,
  type OAuthAppItem,
  type UpdateOAuthAppParams,
} from '@/types/oauthApp';
import { setNamespace } from '@/utils/storeDebug';

import { oauthAppDetailResource, oauthAppListResource } from './projection';
import { type OAuthAppStore } from './store';

const n = setNamespace('oauthApp');

const LIST_PARAMS = {} as Record<string, never>;

type Setter = StoreSetter<OAuthAppStore>;

export const createOAuthAppAction = (set: Setter, get: () => OAuthAppStore, _api?: unknown) =>
  new OAuthAppActionImpl(set, get, _api);

export class OAuthAppActionImpl {
  readonly #get: () => OAuthAppStore;
  readonly #set: Setter;
  readonly #list;
  readonly #detail;
  /** The same app as a list row and as its page. */
  readonly #apps;

  constructor(set: Setter, get: () => OAuthAppStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#set = set;
    this.#list = createReplicaSlice(oauthAppListResource, {
      actionPrefix: n('appList'),
      entity: arrayEntity<OAuthAppItem>((app) => app.id),
      get,
      merge: (incoming, confirmed) => (isEqual(incoming, confirmed) ? undefined : incoming),
      set,
      stateKey: 'appListReplica',
      view: recordLens<OAuthAppStore, OAuthAppItem[]>('appListMap'),
    });
    this.#detail = createReplicaSlice(oauthAppDetailResource, {
      actionPrefix: n('appDetail'),
      effects: {
        onApplied: (_detail, id) => this.#setNotFound(id, false),
        // A settled "no such app" (deleted elsewhere, or a workspace without
        // access): drop it from the list too, and let the page go back.
        onMissing: (id) => {
          this.#apps.remove(id);
          this.#setNotFound(id, true);
        },
      },
      entity: singleEntity<OAuthAppItem>((app) => app.id),
      get,
      isMissing: (incoming) => !incoming,
      merge: (incoming, confirmed) =>
        !incoming || isEqual(incoming, confirmed) ? undefined : incoming,
      set,
      stateKey: 'appDetailReplica',
      view: recordLens<OAuthAppStore, OAuthAppItem>('appDetailMap'),
    });
    this.#apps = linkReplicaEntity<OAuthAppItem>([this.#list, this.#detail]);

    // A settled "no such app" belongs to the workspace that observed it. The two
    // replica views reset themselves on a scope switch (`useSync` re-runs), but
    // this map is not a replica: left alone, opening the same app in the workspace
    // that owns it would read the previous scope's flag and send the page back
    // before the new scope's answer lands.
    subscribeCacheScope(this.#forgetMissingOnScopeChange);
  }

  createApp = async (params: CreateOAuthAppParams) => {
    const created = await oauthAppService.create(params);
    void this.#list.fetch(LIST_PARAMS, { fresh: true });
    return created;
  };

  /** Optimistic: the row and the page drop at once and come back if the call fails. */
  deleteApp = async (id: string) => {
    await this.#apps.optimistic(id, 'remove', () => oauthAppService.delete(id));
  };

  refreshAppDetail = async (id: string) => {
    await this.#detail.fetch(id, { fresh: true });
  };

  refreshAppList = async () => {
    await this.#list.fetch(LIST_PARAMS, { fresh: true });
  };

  /** Returns the only plaintext copy of the new secret; the app then reports `hasSecret`. */
  rotateSecret = async (id: string) => {
    const result = await this.#apps.optimistic(
      id,
      (app) => ({ ...app, hasSecret: true }),
      () => oauthAppService.rotateSecret(id),
    );
    return result.clientSecret;
  };

  setAppEnabled = async (id: string, enabled: boolean) => {
    await this.#apps.optimistic(
      id,
      (app) => ({ ...app, enabled }),
      () => oauthAppService.setEnabled(id, enabled),
    );
  };

  updateApp = async (id: string, value: UpdateOAuthAppParams) => {
    await this.#apps.optimistic(
      id,
      (app) => ({ ...app, ...value }),
      () => oauthAppService.update(id, value),
    );
    // The server normalizes some fields (redirect URIs), so confirm its copy.
    void this.#detail.fetch(id, { fresh: true });
    void this.#list.fetch(LIST_PARAMS, { fresh: true });
  };

  /**
   * One app's page: the persisted copy paints the first frame and the network
   * only confirms. Read the app with `oauthAppSelectors.appById`.
   */
  useFetchAppDetail = (id: string | undefined): ReplicaSyncResult =>
    this.#detail.useSync(id ?? null);

  /** The app list; read it with `oauthAppSelectors.appList`. */
  useFetchAppList = (enabled = true): ReplicaSyncResult =>
    this.#list.useSync(enabled ? LIST_PARAMS : null);

  #setNotFound = (id: string, notFound: boolean) => {
    if (!!this.#get().appNotFoundMap[id] === notFound) return;
    this.#set(
      (state) => ({ appNotFoundMap: { ...state.appNotFoundMap, [id]: notFound } }),
      false,
      n('setNotFound'),
    );
  };

  /** The store is an app-lifetime singleton, so the subscription is never torn down. */
  #forgetMissingOnScopeChange = (): void => {
    if (Object.keys(this.#get().appNotFoundMap).length === 0) return;
    this.#set({ appNotFoundMap: {} }, false, n('scopeChanged'));
  };
}

export type OAuthAppAction = Pick<OAuthAppActionImpl, keyof OAuthAppActionImpl>;
