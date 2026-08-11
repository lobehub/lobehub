import type { AgentGroupDetail, ChatGroupItem, ProjectionSource } from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt, projectionObservation } from '../../core/ingest';
import { removeEntityFromProjectionIndex } from '../../records/indexMutations';
import type { ProjectionStore } from '../../store';
import { chatGroupProjectionRecord, ingestChatGroupDetail, ingestChatGroups } from './ingestors';

type Setter = StoreSetter<ProjectionStore>;

export interface ChatGroupProjectionAction {
  commitChatGroupDetail: (
    scope: string,
    item: AgentGroupDetail,
    source?: ProjectionSource,
    observedAt?: number,
  ) => void;
  commitChatGroupItem: (
    scope: string,
    item: ChatGroupItem,
    source?: ProjectionSource,
    observedAt?: number,
  ) => void;
  commitChatGroups: (scope: string, items: ChatGroupItem[], observedAt?: number) => void;
  deleteChatGroupProjection: (scope: string, id: string, observedAt?: number) => void;
}

class ChatGroupProjectionActionImpl implements ChatGroupProjectionAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  commitChatGroups = (
    scope: string,
    items: ChatGroupItem[],
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestChatGroups(items, projectionObservation('network', observedAt)),
    );
  };

  commitChatGroupDetail = (
    scope: string,
    item: AgentGroupDetail,
    source: ProjectionSource = 'network',
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(
      scope,
      ingestChatGroupDetail(item, projectionObservation(source, observedAt)),
    );
  };

  commitChatGroupItem = (
    scope: string,
    item: ChatGroupItem,
    source: ProjectionSource = 'mutation',
    observedAt = nextProjectionObservedAt(),
  ): void => {
    this.#get().internal_commitProjection(scope, {
      records: [chatGroupProjectionRecord(item, projectionObservation(source, observedAt))],
    });
  };

  deleteChatGroupProjection = (
    scope: string,
    id: string,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    const projectionScope = this.#get().scopes[scope];
    const topicIds = new Set(
      Object.values(projectionScope?.records.topic ?? {})
        .filter((record) => record.fragments.routing?.data.groupId === id)
        .map((record) => record.id),
    );
    const groupIds = new Set([id]);
    const indexes = Object.values(projectionScope?.indexes ?? {}).flatMap((index) => {
      if (!index) return [];
      const withoutGroup = removeEntityFromProjectionIndex(
        index,
        'chatGroup',
        groupIds,
        observedAt,
      );
      const withoutTopics = removeEntityFromProjectionIndex(
        withoutGroup ?? index,
        'topic',
        topicIds,
        observedAt,
      );
      const next = withoutTopics ?? withoutGroup;
      return next ? [next] : [];
    });
    this.#get().internal_commitProjection(scope, {
      indexes,
      tombstones: [
        { id, kind: 'chatGroup', observedAt },
        ...Array.from(topicIds, (topicId) => ({
          id: topicId,
          kind: 'topic' as const,
          observedAt,
        })),
      ],
    });
  };
}

export const createChatGroupProjectionAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new ChatGroupProjectionActionImpl(set, get, api);
