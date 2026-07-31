import type {
  BriefItem,
  EntityFragment,
  EntitySource,
  HomeDailyBriefResponse,
  HomeRecentItem,
  HomeRecentTopicsView,
  HomeTopicView,
  SidebarAgentListResponse,
  TaskListItem,
} from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import type { ClientDataStore } from '../../store';
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

type Setter = StoreSetter<ClientDataStore>;

const observation = (
  source: EntitySource = 'mutation',
  observedAt: number = Date.now(),
): EntityObservation => ({ observedAt, source });

const fragment = <T>(data: T, meta: EntityObservation): EntityFragment<T> => ({ data, ...meta });

export interface HomeClientDataAction {
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
  resolveBriefEntitiesAsRead: (
    scope: string,
    ids: string[],
    resolvedAt?: string,
    observedAt?: number,
  ) => void;
  updateBriefResolution: (
    scope: string,
    id: string,
    resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>,
    observedAt?: number,
  ) => void;
}

class HomeClientDataActionImpl implements HomeClientDataAction {
  readonly #get: () => ClientDataStore;

  constructor(_set: Setter, get: () => ClientDataStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  ingestHomeSidebar = (
    scope: string,
    response: SidebarAgentListResponse,
    observedAt: number,
  ): void => {
    this.#get().internal_commitClientData(
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
    this.#get().internal_commitClientData(
      scope,
      ingestHomeRecentTopics(items, limit, view, observation('network', observedAt)),
    );
  };

  ingestHomeInboxTopics = (scope: string, items: HomeTopicView[], observedAt: number): void => {
    this.#get().internal_commitClientData(
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
    this.#get().internal_commitClientData(
      scope,
      ingestHomeTasks(items, total, observation('network', observedAt)),
    );
  };

  ingestHomeBriefs = (scope: string, items: HomeBriefInput[], observedAt: number): void => {
    this.#get().internal_commitClientData(
      scope,
      ingestHomeBriefs(items, observation('network', observedAt)),
    );
  };

  ingestHomeDailyBrief = (
    scope: string,
    data: HomeDailyBriefResponse,
    observedAt: number,
  ): void => {
    this.#get().internal_commitClientData(
      scope,
      ingestHomeDailyBrief(data, observation('network', observedAt)),
    );
  };

  updateBriefResolution = (
    scope: string,
    id: string,
    resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>,
    observedAt: number = Date.now(),
  ): void => {
    const meta = observation('mutation', observedAt);
    const index = this.#get().scopes[scope]?.indexes['home.unresolvedBriefs'];
    this.#get().internal_commitClientData(scope, {
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
    this.#get().internal_commitClientData(scope, {
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
    this.#get().internal_commitClientData(scope, {
      indexes:
        index?.key === 'home.unresolvedBriefs'
          ? [{ ...index, ...meta, refs: index.refs.filter((ref) => ref.id !== id) }]
          : undefined,
      tombstones: [{ id, kind: 'brief', observedAt }],
    });
  };
}

export const createHomeClientDataAction = (
  set: Setter,
  get: () => ClientDataStore,
  api?: unknown,
) => new HomeClientDataActionImpl(set, get, api);
