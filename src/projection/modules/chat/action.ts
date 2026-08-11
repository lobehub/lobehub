import type { ChatTopic, ChatTopicsQuerySignature, ProjectionSource } from '@lobechat/types';
import { chatAgentViewTopicsIndexKey, chatSidebarTopicsIndexKey } from '@lobechat/types';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt, type ProjectionObservation } from '../../core/ingest';
import { removeEntityFromProjectionIndex } from '../../records/indexMutations';
import type { ProjectionStore } from '../../store';
import {
  chatTopicRecord,
  type ChatTopicsPageInput,
  ingestChatTopicSearchResults,
  ingestChatTopicsPage,
  normalizeChatTopicsSignature,
} from './ingestors';
import { selectChatTopicsIndex } from './selectors';

type Setter = StoreSetter<ProjectionStore>;

export interface ChatTopicCollectionMutationInput {
  agentId?: string | null;
  changedId?: string;
  containerKey: string;
  groupId?: string | null;
  items: ChatTopic[];
  pageSize: number;
  replacedId?: string;
  signature: ChatTopicsQuerySignature;
  surface: 'agentView' | 'sidebar';
  total: number;
}

export interface ChatProjectionAction {
  commitChatTopicCollectionMutation: (
    scope: string,
    input: ChatTopicCollectionMutationInput,
    observedAt?: number,
  ) => void;
  commitChatTopicSearchResults: (
    scope: string,
    items: ChatTopic[],
    observation: ProjectionObservation,
  ) => void;
  commitChatTopicsPage: (
    scope: string,
    input: Omit<ChatTopicsPageInput, 'existing'>,
    observation: ProjectionObservation,
  ) => void;
  deleteChatTopicProjections: (scope: string, ids: string[], observedAt?: number) => void;
}

class ChatProjectionActionImpl implements ChatProjectionAction {
  readonly #get: () => ProjectionStore;

  constructor(_set: Setter, get: () => ProjectionStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  commitChatTopicsPage = (
    scope: string,
    input: Omit<ChatTopicsPageInput, 'existing'>,
    observation: ProjectionObservation,
  ): void => {
    const existing = selectChatTopicsIndex(
      this.#get().scopes[scope],
      input.surface,
      input.containerKey,
    );
    this.#get().internal_commitProjection(
      scope,
      ingestChatTopicsPage({ ...input, existing }, observation),
    );
  };

  commitChatTopicCollectionMutation = (
    scope: string,
    input: ChatTopicCollectionMutationInput,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    const observation = { observedAt, source: 'mutation' as ProjectionSource };
    const key =
      input.surface === 'agentView'
        ? chatAgentViewTopicsIndexKey(input.containerKey)
        : chatSidebarTopicsIndexKey(input.containerKey);
    const changed = input.changedId
      ? input.items.find((item) => item.id === input.changedId)
      : undefined;

    this.#get().internal_commitProjection(scope, {
      indexes: [
        {
          key,
          ...observation,
          persistRefLimit: input.pageSize,
          refs: input.items.map(({ id }) => ({ id, kind: 'topic' as const })),
          signature: normalizeChatTopicsSignature(input.signature),
          total: input.total,
        },
      ],
      records: changed
        ? [
            chatTopicRecord(changed, observation, {
              agentId: input.agentId,
              groupId: input.groupId,
              withDetails: input.signature.withDetails,
            }),
          ]
        : undefined,
      tombstones:
        input.replacedId && input.replacedId !== input.changedId
          ? [{ id: input.replacedId, kind: 'topic', observedAt }]
          : undefined,
    });
  };

  commitChatTopicSearchResults = (
    scope: string,
    items: ChatTopic[],
    observation: ProjectionObservation,
  ): void => {
    this.#get().internal_commitProjection(scope, ingestChatTopicSearchResults(items, observation));
  };

  deleteChatTopicProjections = (
    scope: string,
    ids: string[],
    observedAt = nextProjectionObservedAt(),
  ): void => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    const indexes = Object.values(this.#get().scopes[scope]?.indexes ?? {}).flatMap((index) => {
      if (!index) return [];
      const next = removeEntityFromProjectionIndex(index, 'topic', removed, observedAt);
      return next ? [next] : [];
    });

    this.#get().internal_commitProjection(scope, {
      indexes,
      tombstones: ids.map((id) => ({ id, kind: 'topic' as const, observedAt })),
    });
  };
}

export const createChatProjectionAction = (
  set: Setter,
  get: () => ProjectionStore,
  api?: unknown,
) => new ChatProjectionActionImpl(set, get, api);
