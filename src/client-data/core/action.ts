import type {
  ClientDataCommit,
  ClientDataEntityRecord,
  ClientDataIndex,
  ClientDataSnapshot,
} from '@lobechat/types';

import { isAnonymousScope, isScopeTrusted } from '@/libs/swr/useCacheScope';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { ClientDataRepositoryCommit, HydratedClientData } from '../persistence/repository';
import type { ClientDataStore } from '../store';
import { createEmptyClientDataScope } from './initialState';
import { applyClientDataCommit, materializeDurableCommit } from './reducer';

const n = setNamespace('clientData');
const hydrationInFlight = new Map<string, Promise<void>>();

type Setter = StoreSetter<ClientDataStore>;

export interface ClientDataCoreAction {
  internal_commitClientData: (scope: string, commit: ClientDataCommit) => void;
  prepareClientDataScope: (scope: string) => Promise<void>;
}

export interface ClientDataPersistence {
  commit: (
    scope: string,
    commit: ClientDataRepositoryCommit<ClientDataEntityRecord, ClientDataIndex, ClientDataSnapshot>,
  ) => Promise<void>;
  hydrateScope: (
    scope: string,
  ) => Promise<HydratedClientData<ClientDataEntityRecord, ClientDataIndex, ClientDataSnapshot>>;
}

class ClientDataCoreActionImpl implements ClientDataCoreAction {
  readonly #get: () => ClientDataStore;
  readonly #persistence: ClientDataPersistence;
  readonly #set: Setter;

  constructor(
    persistence: ClientDataPersistence,
    set: Setter,
    get: () => ClientDataStore,
    _api?: unknown,
  ) {
    void _api;
    this.#persistence = persistence;
    this.#set = set;
    this.#get = get;
  }

  internal_commitClientData = (scope: string, commit: ClientDataCommit): void => {
    let durableCommit: ReturnType<typeof materializeDurableCommit> | undefined;

    this.#set(
      (state) => {
        const nextScope = applyClientDataCommit(state.scopes[scope], commit);
        durableCommit = materializeDurableCommit(nextScope, commit);
        return { scopes: { ...state.scopes, [scope]: nextScope } };
      },
      false,
      n('commit'),
    );

    if (!durableCommit || !isScopeTrusted() || isAnonymousScope(scope)) return;
    void this.#persistence.commit(scope, durableCommit).catch((error) => {
      console.warn('[ClientData] Failed to persist commit', error);
    });
  };

  prepareClientDataScope = async (scope: string): Promise<void> => {
    if (this.#get().scopes[scope]?.hydrationStatus === 'ready') return;

    const existing = hydrationInFlight.get(scope);
    if (existing) return existing;

    const request = (async () => {
      this.#set(
        (state) => ({
          scopes: {
            ...state.scopes,
            [scope]: {
              ...(state.scopes[scope] ?? createEmptyClientDataScope()),
              hydrationStatus: 'hydrating',
            },
          },
        }),
        false,
        n('hydrate/start'),
      );

      try {
        const hydrated =
          !isScopeTrusted() || isAnonymousScope(scope)
            ? { entities: [], indexes: [], snapshots: [] }
            : await this.#persistence.hydrateScope(scope);

        this.#set(
          (state) => {
            const merged = applyClientDataCommit(state.scopes[scope], hydrated);
            return {
              scopes: {
                ...state.scopes,
                [scope]: { ...merged, hydrationStatus: 'ready' },
              },
            };
          },
          false,
          n('hydrate/success'),
        );
      } catch (error) {
        console.warn('[ClientData] Failed to hydrate scope', error);
        this.#set(
          (state) => ({
            scopes: {
              ...state.scopes,
              [scope]: {
                ...(state.scopes[scope] ?? createEmptyClientDataScope()),
                hydrationStatus: 'ready',
              },
            },
          }),
          false,
          n('hydrate/fallback'),
        );
      } finally {
        hydrationInFlight.delete(scope);
      }
    })();

    hydrationInFlight.set(scope, request);
    return request;
  };
}

export const createClientDataCoreAction = (
  persistence: ClientDataPersistence,
  set: Setter,
  get: () => ClientDataStore,
  api?: unknown,
) => new ClientDataCoreActionImpl(persistence, set, get, api);
