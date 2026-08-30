import type {
  BriefItem,
  ChatTopicStatus,
  ProjectionFragment,
  ProjectionSource,
  TaskProjection,
  TaskStatus,
  TopicProjection,
} from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt } from '../core/ingest';
import type { ProjectionStore } from '../store';
import { findTaskProjection } from './selectors';

type Setter = StoreSetter<ProjectionStore>;

interface ProjectionObservation {
  observedAt: number;
  source: ProjectionSource;
}

const observation = (
  source: ProjectionSource = 'mutation',
  observedAt: number = nextProjectionObservedAt(),
): ProjectionObservation => ({ observedAt, source });

const fragment = <T>(data: T, meta: ProjectionObservation): ProjectionFragment<T> => ({
  data,
  ...meta,
});

export interface ProjectionRecordAction {
  updateBriefReadState: (
    scope: string,
    id: string,
    readAt: Date | string | null,
    observedAt?: number,
  ) => void;
  updateTaskProjectionName: (
    scope: string,
    identity: string,
    name: string,
    observedAt?: number,
  ) => void;
  updateTaskProjectionStatus: (
    scope: string,
    identity: string,
    status: TaskStatus,
    source?: ProjectionSource,
    observedAt?: number,
  ) => void;
  updateTopicProjectionStatus: (
    scope: string,
    id: string,
    status: ChatTopicStatus,
    source?: ProjectionSource,
    observedAt?: number,
  ) => void;
  updateTopicProjectionTitle: (
    scope: string,
    id: string,
    title: string,
    observedAt?: number,
  ) => void;
}

class ProjectionRecordActionImpl implements ProjectionRecordAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  updateTopicProjectionStatus = (
    scope: string,
    id: string,
    status: ChatTopicStatus,
    source: ProjectionSource = 'mutation',
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const meta = observation(source, observedAt);
    const record: TopicProjection = {
      fragments: { status: fragment({ status }, meta) },
      id,
      kind: 'topic',
    };
    this.#get().internal_commitProjection(scope, { records: [record] });
  };

  updateTopicProjectionTitle = (
    scope: string,
    id: string,
    title: string,
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const meta = observation('mutation', observedAt);
    const record: TopicProjection = {
      fragments: { display: fragment({ title }, meta) },
      id,
      kind: 'topic',
    };
    this.#get().internal_commitProjection(scope, { records: [record] });
  };

  updateTaskProjectionStatus = (
    scope: string,
    identity: string,
    status: TaskStatus,
    source: ProjectionSource = 'mutation',
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const current = findTaskProjection(this.#get().scopes[scope], identity);
    if (!current) return;
    const meta = observation(source, observedAt);
    const record: TaskProjection = {
      fragments: { lifecycle: fragment({ status }, meta) },
      id: current.id,
      kind: 'task',
    };
    this.#get().internal_commitProjection(scope, { records: [record] });
  };

  updateTaskProjectionName = (
    scope: string,
    identity: string,
    name: string,
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const current = findTaskProjection(this.#get().scopes[scope], identity);
    if (!current) return;
    const meta = observation('mutation', observedAt);
    const record: TaskProjection = {
      fragments: { display: fragment({ name }, meta) },
      id: current.id,
      kind: 'task',
    };
    this.#get().internal_commitProjection(scope, { records: [record] });
  };

  updateBriefReadState = (
    scope: string,
    id: string,
    readAt: BriefItem['readAt'],
    observedAt: number = nextProjectionObservedAt(),
  ): void => {
    const meta = observation('mutation', observedAt);
    this.#get().internal_commitProjection(scope, {
      records: [
        {
          fragments: { readState: fragment({ readAt }, meta) },
          id,
          kind: 'brief',
        },
      ],
    });
  };
}

export const createProjectionRecordAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new ProjectionRecordActionImpl(set, get, api);
