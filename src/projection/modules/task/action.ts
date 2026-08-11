import type {
  ProjectionSource,
  TaskDetailData,
  TaskListItem,
  TaskListQuerySignature,
} from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt, projectionObservation } from '../../core/ingest';
import { removeEntityFromProjectionIndex } from '../../records/indexMutations';
import type { ProjectionStore } from '../../store';
import {
  ingestTaskDetail,
  ingestTaskGroupList,
  ingestTaskList,
  type TaskGroupProjectionInput,
} from './ingestors';
import { findTaskRecordByIdentity } from './selectors';

type Setter = StoreSetter<ProjectionStore>;

export interface TaskProjectionAction {
  commitTaskDetail: (
    scope: string,
    detail: TaskDetailData,
    source?: ProjectionSource,
    observedAt?: number,
  ) => void;
  commitTaskGroupList: (
    scope: string,
    groups: TaskGroupProjectionInput[],
    signature: TaskListQuerySignature,
    observedAt?: number,
  ) => void;
  commitTaskList: (
    scope: string,
    items: TaskListItem[],
    total: number,
    signature: TaskListQuerySignature,
    observedAt?: number,
  ) => void;
  deleteTaskProjection: (scope: string, identity: string, observedAt?: number) => void;
}

class TaskProjectionActionImpl implements TaskProjectionAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  commitTaskList = (
    scope: string,
    items: TaskListItem[],
    total: number,
    signature: TaskListQuerySignature,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestTaskList(items, total, signature, projectionObservation('network', observedAt)),
    );
  };

  commitTaskGroupList = (
    scope: string,
    groups: TaskGroupProjectionInput[],
    signature: TaskListQuerySignature,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestTaskGroupList(groups, signature, projectionObservation('network', observedAt)),
    );
  };

  commitTaskDetail = (
    scope: string,
    detail: TaskDetailData,
    source: ProjectionSource = 'network',
    observedAt = nextProjectionObservedAt(),
  ): void => {
    const current = findTaskRecordByIdentity(
      this.#get().scopes[scope],
      detail.id ?? detail.identifier,
    );
    const recordId = current?.id ?? detail.id ?? detail.identifier;
    this.#get().internal_commitProjection(
      scope,
      ingestTaskDetail(detail, recordId, projectionObservation(source, observedAt)),
    );
  };

  deleteTaskProjection = (
    scope: string,
    identity: string,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    const projectionScope = this.#get().scopes[scope];
    const record = findTaskRecordByIdentity(projectionScope, identity);
    if (!record) return;
    const ids = new Set([record.id]);
    const indexes = Object.values(projectionScope?.indexes ?? {}).flatMap((index) => {
      if (!index) return [];
      const next = removeEntityFromProjectionIndex(index, 'task', ids, observedAt);
      return next ? [next] : [];
    });
    this.#get().internal_commitProjection(scope, {
      indexes,
      tombstones: [{ id: record.id, kind: 'task', observedAt }],
    });
  };
}

export const createTaskProjectionAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new TaskProjectionActionImpl(set, get, api);
