import type {
  BriefItem,
  HomeDailyBriefResponse,
  HomeRecentItem,
  HomeRecentTopicsView,
  HomeTopicView,
  ProjectionFragment,
  ProjectionSource,
  SidebarAgentListResponse,
  TaskListItem,
} from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt } from '../../core/ingest';
import { removeEntityFromProjectionIndex } from '../../records/indexMutations';
import type { ProjectionStore } from '../../store';
import {
  type HomeBriefInput,
  ingestHomeBriefs,
  ingestHomeDailyBrief,
  ingestHomeInboxTopics,
  ingestHomeRecentTopics,
  ingestHomeScheduledTasks,
  ingestHomeSidebar,
  ingestHomeTasks,
  type ProjectionObservation,
} from './ingestors';

type Setter = StoreSetter<ProjectionStore>;

const observation = (
  source: ProjectionSource = 'mutation',
  observedAt: number = nextProjectionObservedAt(),
): ProjectionObservation => ({ observedAt, source });

const fragment = <T>(data: T, meta: ProjectionObservation): ProjectionFragment<T> => ({
  data,
  ...meta,
});

export interface HomeProjectionAction {
  commitHomeSidebar: (
    scope: string,
    response: SidebarAgentListResponse,
    observedAt?: number,
  ) => void;
  deleteBriefProjection: (scope: string, id: string, observedAt?: number) => void;
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
  ingestHomeScheduledTasks: (
    scope: string,
    items: TaskListItem[],
    total: number,
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
  resolveBriefProjectionsAsRead: (
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

class HomeProjectionActionImpl implements HomeProjectionAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  commitHomeSidebar = (
    scope: string,
    response: SidebarAgentListResponse,
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestHomeSidebar(response, observation('mutation', observedAt)),
    );
  };

  ingestHomeSidebar = (
    scope: string,
    response: SidebarAgentListResponse,
    observedAt: number,
  ): void => {
    this.#get().internal_commitProjection(
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
    this.#get().internal_commitProjection(
      scope,
      ingestHomeRecentTopics(items, limit, view, observation('network', observedAt)),
    );
  };

  ingestHomeInboxTopics = (scope: string, items: HomeTopicView[], observedAt: number): void => {
    this.#get().internal_commitProjection(
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
    this.#get().internal_commitProjection(
      scope,
      ingestHomeTasks(items, total, observation('network', observedAt)),
    );
  };

  ingestHomeScheduledTasks = (
    scope: string,
    items: TaskListItem[],
    total: number,
    observedAt: number,
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestHomeScheduledTasks(items, total, observation('network', observedAt)),
    );
  };

  ingestHomeBriefs = (scope: string, items: HomeBriefInput[], observedAt: number): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestHomeBriefs(items, observation('network', observedAt)),
    );
  };

  ingestHomeDailyBrief = (
    scope: string,
    data: HomeDailyBriefResponse,
    observedAt: number,
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestHomeDailyBrief(data, observation('network', observedAt)),
    );
  };

  updateBriefResolution = (
    scope: string,
    id: string,
    resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>,
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const meta = observation('mutation', observedAt);
    const index = this.#get().scopes[scope]?.indexes['home.unresolvedBriefs'];
    this.#get().internal_commitProjection(scope, {
      records: [
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

  resolveBriefProjectionsAsRead = (
    scope: string,
    ids: string[],
    resolvedAt: string = new Date().toISOString(),
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    if (ids.length === 0) return;
    const index = this.#get().scopes[scope]?.indexes['home.unresolvedBriefs'];
    const removed = new Set(ids);
    const meta = observation('mutation', observedAt);
    this.#get().internal_commitProjection(scope, {
      records: ids.map((id) => {
        const currentReadAt =
          this.#get().scopes[scope]?.records.brief[id]?.fragments.readState?.data.readAt;
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

  deleteBriefProjection = (
    scope: string,
    id: string,
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const indexes = Object.values(this.#get().scopes[scope]?.indexes ?? {}).flatMap((index) => {
      if (!index) return [];
      const next = removeEntityFromProjectionIndex(index, 'brief', new Set([id]), observedAt);
      return next ? [next] : [];
    });
    this.#get().internal_commitProjection(scope, {
      indexes,
      tombstones: [{ id, kind: 'brief', observedAt }],
    });
  };
}

export const createHomeProjectionAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new HomeProjectionActionImpl(set, get, api);
