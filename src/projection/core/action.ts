import type { ProjectionCommit } from '@lobechat/types';

import { isAnonymousScope, isScopeTrusted } from '@/libs/swr/useCacheScope';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { ProjectionPersistence } from '../persistence/types';
import type { ProjectionStore } from '../store';
import { createEmptyProjectionScope } from './initialState';
import { applyProjectionCommit, materializeProjectionCommit } from './reducer';

const n = setNamespace('projection');
const hydrationInFlight = new Map<string, Promise<void>>();

type Setter = StoreSetter<ProjectionStore>;

export interface ProjectionCoreAction {
  internal_commitProjection: (scope: string, commit: ProjectionCommit) => void;
  internal_commitProjectionForDevtools: (scope: string, commit: ProjectionCommit) => Promise<void>;
  prepareProjectionScope: (scope: string) => Promise<void>;
}

class ProjectionCoreActionImpl implements ProjectionCoreAction {
  readonly #get: () => ProjectionStore;
  readonly #persistence: ProjectionPersistence;
  readonly #set: Setter;

  constructor(
    persistence: ProjectionPersistence,
    set: Setter,
    get: () => ProjectionStore,
    _api?: unknown,
  ) {
    void _api;
    this.#persistence = persistence;
    this.#set = set;
    this.#get = get;
  }

  #applyCommit = (
    scope: string,
    commit: ProjectionCommit,
  ): ReturnType<typeof materializeProjectionCommit> | undefined => {
    let durableCommit: ReturnType<typeof materializeProjectionCommit> | undefined;

    this.#set(
      (state) => {
        const nextScope = applyProjectionCommit(state.scopes[scope], commit);
        durableCommit = materializeProjectionCommit(nextScope, commit);
        return { scopes: { ...state.scopes, [scope]: nextScope } };
      },
      false,
      n('commit'),
    );

    return durableCommit;
  };

  internal_commitProjection = (scope: string, commit: ProjectionCommit): void => {
    const durableCommit = this.#applyCommit(scope, commit);

    if (!durableCommit || !isScopeTrusted() || isAnonymousScope(scope)) return;
    void this.#persistence.commit(scope, durableCommit).catch((error) => {
      console.warn('[Projection] Failed to persist commit', error);
    });
  };

  internal_commitProjectionForDevtools = async (
    scope: string,
    commit: ProjectionCommit,
  ): Promise<void> => {
    const durableCommit = this.#applyCommit(scope, commit);
    if (!durableCommit) return;
    try {
      await this.#persistence.commit(scope, durableCommit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The live Projection Store was updated, but local database persistence failed: ${message}`,
        { cause: error },
      );
    }
  };

  prepareProjectionScope = async (scope: string): Promise<void> => {
    if (this.#get().scopes[scope]?.hydrationStatus === 'ready') return;

    const existing = hydrationInFlight.get(scope);
    if (existing) return existing;

    const request = (async () => {
      this.#set(
        (state) => ({
          scopes: {
            ...state.scopes,
            [scope]: {
              ...(state.scopes[scope] ?? createEmptyProjectionScope()),
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
            ? { indexes: [], records: [], snapshots: [] }
            : await this.#persistence.hydrateScope(scope);

        this.#set(
          (state) => {
            const merged = applyProjectionCommit(state.scopes[scope], hydrated);
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
        console.warn('[Projection] Failed to hydrate scope', error);
        this.#set(
          (state) => ({
            scopes: {
              ...state.scopes,
              [scope]: {
                ...(state.scopes[scope] ?? createEmptyProjectionScope()),
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

export const createProjectionCoreAction = (
  persistence: ProjectionPersistence,
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new ProjectionCoreActionImpl(persistence, set, get, api);
