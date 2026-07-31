import type {
  BriefItem,
  ChatTopicStatus,
  EntityFragment,
  EntitySource,
  HomeDailyBriefResponse,
  HomeDataCommit,
  HomeRecentItem,
  HomeRecentTopicsView,
  HomeTaskRecord,
  HomeTopicRecord,
  HomeTopicView,
  SidebarAgentListResponse,
  TaskListItem,
  TaskStatus,
} from '@lobechat/types';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { isAnonymousScope, isScopeTrusted } from '@/libs/swr/useCacheScope';
import type { StoreSetter } from '@/store/types';
import { isDev } from '@/utils/env';
import { setNamespace } from '@/utils/storeDebug';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import {
  type EntityObservation,
  type HomeBriefInput,
  ingestHomeBriefs,
  ingestHomeDailyBrief,
  ingestHomeInboxTopics,
  ingestHomeRecentTopics,
  ingestHomeSidebar,
  ingestHomeTasks,
} from './ingestors';
import { createEmptyEntityScope, type EntityStoreState, initialState } from './initialState';
import { applyHomeDataCommit, materializeDurableCommit } from './reducer';
import { homeEntityRepository } from './repository';
import { findTaskRecord } from './selectors';

const n = setNamespace('entityData');
const hydrationInFlight = new Map<string, Promise<void>>();

type Setter = StoreSetter<EntityStore>;

const observation = (
  source: EntitySource = 'mutation',
  observedAt: number = Date.now(),
): EntityObservation => ({ observedAt, source });

const fragment = <T>(data: T, meta: EntityObservation): EntityFragment<T> => ({ data, ...meta });

export interface EntityDataAction {
  deleteBriefEntity: (scope: string, id: string, observedAt?: number) => void;
  ingestHomeBriefs: (scope: string, items: HomeBriefInput[], observedAt: number) => void;
  ingestHomeDailyBrief: (scope: string, data: HomeDailyBriefResponse, observedAt: number) => void;
  ingestHomeInboxTopics: (scope: string, items: HomeTopicView[], observedAt: number) => void;
  ingestHomeRecentTopics: (
    scope: string,
    items: HomeRecentItem[],
    limit: number,
    view: HomeRecentTopicsView,
    observedAt: number,
  ) => void;
  ingestHomeSidebar: (
    scope: string,
    response: SidebarAgentListResponse,
    observedAt: number,
  ) => void;
  ingestHomeTasks: (
    scope: string,
    items: TaskListItem[],
    total: number,
    observedAt: number,
  ) => void;
  internal_commitHomeData: (scope: string, commit: HomeDataCommit) => void;
  prepareEntityScope: (scope: string) => Promise<void>;
  resolveBriefEntitiesAsRead: (
    scope: string,
    ids: string[],
    resolvedAt?: string,
    observedAt?: number,
  ) => void;
  updateBriefReadState: (
    scope: string,
    id: string,
    readAt: Date | string | null,
    observedAt?: number,
  ) => void;
  updateBriefResolution: (
    scope: string,
    id: string,
    resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>,
    observedAt?: number,
  ) => void;
  updateTaskEntityStatus: (
    scope: string,
    identity: string,
    status: TaskStatus,
    source?: EntitySource,
    observedAt?: number,
  ) => void;
  updateTopicEntityStatus: (
    scope: string,
    id: string,
    status: ChatTopicStatus,
    source?: EntitySource,
    observedAt?: number,
  ) => void;
  updateTopicEntityTitle: (scope: string, id: string, title: string, observedAt?: number) => void;
}

export interface EntityStore extends EntityStoreState, EntityDataAction {}

class EntityDataActionImpl implements EntityDataAction {
  readonly #get: () => EntityStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EntityStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_commitHomeData = (scope: string, commit: HomeDataCommit): void => {
    let durableCommit: ReturnType<typeof materializeDurableCommit> | undefined;

    this.#set(
      (state) => {
        const nextScope = applyHomeDataCommit(state.scopes[scope], commit);
        durableCommit = materializeDurableCommit(nextScope, commit);
        return { scopes: { ...state.scopes, [scope]: nextScope } };
      },
      false,
      n('commit'),
    );

    if (!durableCommit || !isScopeTrusted() || isAnonymousScope(scope)) return;
    void homeEntityRepository.commit(scope, durableCommit).catch((error) => {
      console.warn('[EntityData] Failed to persist commit', error);
    });
  };

  prepareEntityScope = async (scope: string): Promise<void> => {
    if (this.#get().scopes[scope]?.hydrationStatus === 'ready') return;

    const existing = hydrationInFlight.get(scope);
    if (existing) return existing;

    const request = (async () => {
      this.#set(
        (state) => ({
          scopes: {
            ...state.scopes,
            [scope]: {
              ...(state.scopes[scope] ?? createEmptyEntityScope()),
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
            : await homeEntityRepository.hydrateScope(scope);

        this.#set(
          (state) => {
            const merged = applyHomeDataCommit(state.scopes[scope], hydrated);
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
        console.warn('[EntityData] Failed to hydrate scope', error);
        this.#set(
          (state) => ({
            scopes: {
              ...state.scopes,
              [scope]: {
                ...(state.scopes[scope] ?? createEmptyEntityScope()),
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

  ingestHomeSidebar = (
    scope: string,
    response: SidebarAgentListResponse,
    observedAt: number,
  ): void => {
    this.internal_commitHomeData(
      scope,
      ingestHomeSidebar(response, observation('network', observedAt)),
    );
  };

  ingestHomeRecentTopics = (
    scope: string,
    items: HomeRecentItem[],
    limit: number,
    view: HomeRecentTopicsView,
    observedAt: number,
  ): void => {
    this.internal_commitHomeData(
      scope,
      ingestHomeRecentTopics(items, limit, view, observation('network', observedAt)),
    );
  };

  ingestHomeInboxTopics = (scope: string, items: HomeTopicView[], observedAt: number): void => {
    this.internal_commitHomeData(
      scope,
      ingestHomeInboxTopics(items, observation('network', observedAt)),
    );
  };

  ingestHomeTasks = (
    scope: string,
    items: TaskListItem[],
    total: number,
    observedAt: number,
  ): void => {
    this.internal_commitHomeData(
      scope,
      ingestHomeTasks(items, total, observation('network', observedAt)),
    );
  };

  ingestHomeBriefs = (scope: string, items: HomeBriefInput[], observedAt: number): void => {
    this.internal_commitHomeData(
      scope,
      ingestHomeBriefs(items, observation('network', observedAt)),
    );
  };

  ingestHomeDailyBrief = (
    scope: string,
    data: HomeDailyBriefResponse,
    observedAt: number,
  ): void => {
    this.internal_commitHomeData(
      scope,
      ingestHomeDailyBrief(data, observation('network', observedAt)),
    );
  };

  updateTopicEntityStatus = (
    scope: string,
    id: string,
    status: ChatTopicStatus,
    source: EntitySource = 'mutation',
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation(source, observedAt);
    const record: HomeTopicRecord = {
      fragments: { status: fragment({ status }, meta) },
      id,
      kind: 'topic',
    };
    this.internal_commitHomeData(scope, { entities: [record] });
  };

  updateTopicEntityTitle = (
    scope: string,
    id: string,
    title: string,
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation('mutation', observedAt);
    const record: HomeTopicRecord = {
      fragments: { display: fragment({ title }, meta) },
      id,
      kind: 'topic',
    };
    this.internal_commitHomeData(scope, { entities: [record] });
  };

  updateTaskEntityStatus = (
    scope: string,
    identity: string,
    status: TaskStatus,
    source: EntitySource = 'mutation',
    observedAt: number = Date.now(),
  ): void => {
    const current = findTaskRecord(this.#get().scopes[scope], identity);
    if (!current) return;
    const meta = observation(source, observedAt);
    const record: HomeTaskRecord = {
      fragments: { lifecycle: fragment({ status }, meta) },
      id: current.id,
      kind: 'task',
    };
    this.internal_commitHomeData(scope, { entities: [record] });
  };

  updateBriefReadState = (
    scope: string,
    id: string,
    readAt: Date | string | null,
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation('mutation', observedAt);
    this.internal_commitHomeData(scope, {
      entities: [
        {
          fragments: { readState: fragment({ readAt }, meta) },
          id,
          kind: 'brief',
        },
      ],
    });
  };

  updateBriefResolution = (
    scope: string,
    id: string,
    resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>,
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation('mutation', observedAt);
    const index = this.#get().scopes[scope]?.indexes['home.unresolvedBriefs'];
    this.internal_commitHomeData(scope, {
      entities: [
        {
          fragments: { resolution: fragment(resolution, meta) },
          id,
          kind: 'brief',
        },
      ],
      indexes:
        index?.key === 'home.unresolvedBriefs'
          ? [{ ...index, ...meta, refs: index.refs.filter((ref) => ref.id !== id) }]
          : undefined,
    });
  };

  resolveBriefEntitiesAsRead = (
    scope: string,
    ids: string[],
    resolvedAt: string = new Date().toISOString(),
    observedAt: number = Date.now(),
  ): void => {
    if (ids.length === 0) return;
    const index = this.#get().scopes[scope]?.indexes['home.unresolvedBriefs'];
    const removed = new Set(ids);
    const meta = observation('mutation', observedAt);
    this.internal_commitHomeData(scope, {
      entities: ids.map((id) => {
        const currentReadAt =
          this.#get().scopes[scope]?.entities.brief[id]?.fragments.readState?.data.readAt;
        return {
          fragments: {
            readState: fragment({ readAt: currentReadAt ?? resolvedAt }, meta),
            resolution: fragment(
              { resolvedAction: 'read', resolvedAt, resolvedComment: null },
              meta,
            ),
          },
          id,
          kind: 'brief' as const,
        };
      }),
      indexes:
        index?.key === 'home.unresolvedBriefs'
          ? [{ ...index, ...meta, refs: index.refs.filter((ref) => !removed.has(ref.id)) }]
          : undefined,
    });
  };

  deleteBriefEntity = (scope: string, id: string, observedAt: number = Date.now()): void => {
    const index = this.#get().scopes[scope]?.indexes['home.unresolvedBriefs'];
    const meta = observation('mutation', observedAt);
    this.internal_commitHomeData(scope, {
      indexes:
        index?.key === 'home.unresolvedBriefs'
          ? [{ ...index, ...meta, refs: index.refs.filter((ref) => ref.id !== id) }]
          : undefined,
      tombstones: [{ id, kind: 'brief', observedAt }],
    });
  };
}

const createEntityDataSlice = (set: Setter, get: () => EntityStore, api?: unknown) =>
  new EntityDataActionImpl(set, get, api);

const createStore: StateCreator<EntityStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<EntityStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<EntityDataAction>([createEntityDataSlice(...parameters)]),
});

const devtools = createDevtools('entityData');

export const useEntityStore = createWithEqualityFn<EntityStore>()(
  subscribeWithSelector(
    devtools(createStore, {
      name: 'LobeChat_EntityData' + (isDev ? '_DEV' : ''),
    }),
  ),
  shallow,
);

expose('entityData', useEntityStore);

export const getEntityStoreState = () => useEntityStore.getState();
