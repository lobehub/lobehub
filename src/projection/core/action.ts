import type { ProjectionCommit, ProjectionHydrationRequest } from '@lobechat/types';

import { projectionBootSpanNames } from '@/libs/bootMetrics/spanNames';
import { bootTiming } from '@/libs/bootTiming';
import { isAnonymousScope, isScopeTrusted } from '@/libs/swr/useCacheScope';
import type { StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import type { ProjectionPersistence } from '../persistence/types';
import type { ProjectionStore } from '../store';
import { createEmptyProjectionScope } from './initialState';
import { applyProjectionCommit, materializeProjectionCommit } from './reducer';

const n = setNamespace('projection');
const hydrationInFlight = new Map<string, Promise<void>>();

const hydrationRequestKey = (scope: string, request: ProjectionHydrationRequest): string => {
  const indexes = [...(request.indexes ?? [])].sort();
  const records = (request.records ?? [])
    .map(({ fragments, ids, kind }) => ({
      fragments: [...fragments].sort(),
      ids: [...ids].sort(),
      kind,
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));
  const snapshots = [...(request.snapshots ?? [])].sort();
  return `${scope}:${JSON.stringify({ indexes, records, snapshots })}`;
};

type Setter = StoreSetter<ProjectionStore>;

export interface ProjectionCoreAction {
  hydrateProjection: (scope: string, request: ProjectionHydrationRequest) => Promise<void>;
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

  hydrateProjection = async (scope: string, request: ProjectionHydrationRequest): Promise<void> => {
    if (!isScopeTrusted() || isAnonymousScope(scope)) return;
    if (
      (request.indexes?.length ?? 0) === 0 &&
      (request.records?.length ?? 0) === 0 &&
      (request.snapshots?.length ?? 0) === 0
    ) {
      return;
    }

    const key = hydrationRequestKey(scope, request);
    const existing = hydrationInFlight.get(key);
    if (existing) return existing;

    const operation = bootTiming
      .span(projectionBootSpanNames.hydration, async () => {
        const hydration = await this.#persistence.hydrate(scope, request);
        bootTiming.spanSync(projectionBootSpanNames.storeInject, () => {
          this.#set(
            (state) => ({
              scopes: {
                ...state.scopes,
                [scope]: applyProjectionCommit(state.scopes[scope], hydration),
              },
            }),
            false,
            n('hydrate/view'),
          );
        });
      })
      .finally(() => hydrationInFlight.delete(key));

    hydrationInFlight.set(key, operation);
    return operation;
  };

  prepareProjectionScope = async (scope: string): Promise<void> => {
    if (this.#get().scopes[scope]?.hydrationStatus === 'ready') return;
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
      n('scope/ready'),
    );
  };
}

export const createProjectionCoreAction = (
  persistence: ProjectionPersistence,
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new ProjectionCoreActionImpl(persistence, set, get, api);
