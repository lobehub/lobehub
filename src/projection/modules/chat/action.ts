import type {
  ChatTopic,
  ChatTopicSearchSignature,
  ChatTopicsIndex,
  ChatTopicsQuerySignature,
  ProjectionSource,
} from '@lobechat/types';
import {
  CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX,
  CHAT_SIDEBAR_TOPICS_INDEX_PREFIX,
  chatAgentViewTopicsIndexKey,
  chatSidebarTopicsIndexKey,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import type { StoreSetter } from '@/store/types';

import { nextProjectionObservedAt, type ProjectionObservation } from '../../core/ingest';
import { activeProjectionRecord } from '../../core/record';
import { removeEntityFromProjectionIndex } from '../../records/indexMutations';
import type { ProjectionStore } from '../../store';
import {
  chatTopicRecord,
  type ChatTopicsPageInput,
  ingestChatTopicSearchResults,
  ingestChatTopicsPage,
  normalizeChatTopicsSignature,
} from './ingestors';
import { type ChatTopicDispatch, reduceChatTopics } from './mutation';
import { selectChatTopicItem, selectChatTopicsIndex, selectChatTopicsItems } from './selectors';

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

export interface ChatTopicMutationInput {
  containerKey?: string;
  context?: { agentId?: string | null; groupId?: string | null };
  pageSize?: number;
  payload: ChatTopicDispatch;
  signature?: ChatTopicsQuerySignature;
}

export interface ChatProjectionAction {
  clearChatTopicStatusWrite: (scope: string, id: string) => void;
  commitChatTopicCollectionMutation: (
    scope: string,
    input: ChatTopicCollectionMutationInput,
    observedAt?: number,
  ) => void;
  commitChatTopicRecords: (
    scope: string,
    items: ChatTopic[],
    observation: ProjectionObservation,
    context?: { agentId?: string | null; groupId?: string | null; withDetails?: boolean },
  ) => ChatTopic[];
  commitChatTopicSearchResults: (
    scope: string,
    items: ChatTopic[],
    signature: ChatTopicSearchSignature,
    observation: ProjectionObservation,
  ) => void;
  commitChatTopicsPage: (
    scope: string,
    input: Omit<ChatTopicsPageInput, 'existing'>,
    observation: ProjectionObservation,
  ) => void;
  deleteChatTopicProjections: (scope: string, ids: string[], observedAt?: number) => void;
  mutateChatTopicProjection: (
    scope: string,
    input: ChatTopicMutationInput,
    observedAt?: number,
  ) => void;
  pinChatTopicStatusWrite: (scope: string, id: string, status: string, expiresAt: number) => void;
}

class ChatProjectionActionImpl implements ChatProjectionAction {
  readonly #get: () => ProjectionStore;
  readonly #pendingStatusWrites = new Map<string, { expiresAt: number; status: string }>();

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
      ingestChatTopicsPage(
        { ...input, existing, items: this.#reconcileNetworkItems(scope, input.items) },
        observation,
      ),
    );
  };

  commitChatTopicRecords = (
    scope: string,
    items: ChatTopic[],
    observation: ProjectionObservation,
    context?: { agentId?: string | null; groupId?: string | null; withDetails?: boolean },
  ): ChatTopic[] => {
    const reconciled = this.#reconcileNetworkItems(scope, items);
    this.#get().internal_commitProjection(scope, {
      records: reconciled.map((item) => chatTopicRecord(item, observation, context)),
    });
    return reconciled;
  };

  #statusWriteKey = (scope: string, id: string): string => `${scope}:${id}`;

  #reconcileNetworkItems = (scope: string, items: ChatTopic[]): ChatTopic[] =>
    items.map((item) => {
      const key = this.#statusWriteKey(scope, item.id);
      const pending = this.#pendingStatusWrites.get(key);
      if (!pending) return item;
      if (pending.expiresAt <= Date.now() || item.status === pending.status) {
        this.#pendingStatusWrites.delete(key);
        return item;
      }
      return { ...item, status: pending.status as ChatTopic['status'] };
    });

  pinChatTopicStatusWrite = (
    scope: string,
    id: string,
    status: string,
    expiresAt: number,
  ): void => {
    this.#pendingStatusWrites.set(this.#statusWriteKey(scope, id), { expiresAt, status });
  };

  clearChatTopicStatusWrite = (scope: string, id: string): void => {
    this.#pendingStatusWrites.delete(this.#statusWriteKey(scope, id));
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
    signature: ChatTopicSearchSignature,
    observation: ProjectionObservation,
  ): void => {
    const reconciled = this.#reconcileNetworkItems(scope, items);
    this.#get().internal_commitProjection(
      scope,
      ingestChatTopicSearchResults(reconciled, signature, observation),
    );
  };

  mutateChatTopicProjection = (
    scope: string,
    input: ChatTopicMutationInput,
    observedAt = nextProjectionObservedAt(),
  ): void => {
    const { payload } = input;
    if (payload.type === 'deleteTopic') {
      this.deleteChatTopicProjections(scope, [payload.id], observedAt);
      return;
    }

    const projectionScope = this.#get().scopes[scope];
    const sourceId = payload.type === 'addTopic' ? payload.value.id : payload.id;
    const isChatIndex = (index: unknown): index is ChatTopicsIndex => {
      if (!index || typeof index !== 'object' || !('key' in index)) return false;
      const key = (index as { key: string }).key;
      return (
        key.startsWith(CHAT_SIDEBAR_TOPICS_INDEX_PREFIX) ||
        key.startsWith(CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX)
      );
    };
    const containerKeyOf = (index: ChatTopicsIndex): string =>
      index.key.startsWith(CHAT_SIDEBAR_TOPICS_INDEX_PREFIX)
        ? index.key.slice(CHAT_SIDEBAR_TOPICS_INDEX_PREFIX.length)
        : index.key.slice(CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX.length);
    const indexes = Object.values(projectionScope?.indexes ?? {}).filter(isChatIndex);
    const targetIndexes = indexes.filter((index) => {
      if (payload.type === 'addTopic') return containerKeyOf(index) === input.containerKey;
      return index.refs.some((ref) => ref.id === payload.id);
    });

    const observation = { observedAt, source: 'mutation' as ProjectionSource };
    const nextIndexes: ChatTopicsIndex[] = [];
    let changedTopic: ChatTopic | undefined;
    let withDetails = false;

    for (const index of targetIndexes) {
      const currentItems = selectChatTopicsItems(projectionScope, index) as ChatTopic[] | undefined;
      if (!currentItems) continue;
      const nextItems = reduceChatTopics(currentItems, payload);
      if (isEqual(currentItems, nextItems)) continue;

      const totalDelta = nextItems.length - currentItems.length;
      nextIndexes.push({
        ...index,
        ...observation,
        refs: nextItems.map(({ id }) => ({ id, kind: 'topic' as const })),
        total: Math.max(nextItems.length, index.total + totalDelta),
      });
      withDetails ||= Boolean(index.signature.withDetails);
      const changedId = payload.type === 'replaceTopicId' ? payload.nextId : sourceId;
      changedTopic ??= nextItems.find((item) => item.id === changedId);
    }

    // A mutation can arrive before a list index is hydrated (for example the
    // first-send optimistic topic). Preserve the canonical record and seed the
    // owning sidebar index so the row remains observable immediately.
    if (!changedTopic) {
      const base =
        payload.type === 'addTopic'
          ? []
          : sourceId && projectionScope
            ? [selectChatTopicItem(projectionScope, sourceId)].filter(Boolean)
            : [];
      const next = reduceChatTopics(base as ChatTopic[], payload);
      const changedId = payload.type === 'replaceTopicId' ? payload.nextId : sourceId;
      changedTopic = next.find((item) => item.id === changedId);

      if (payload.type === 'addTopic' && input.containerKey && changedTopic) {
        nextIndexes.push({
          key: chatSidebarTopicsIndexKey(input.containerKey),
          ...observation,
          page: 0,
          persistRefLimit: input.pageSize ?? 20,
          refs: [{ id: changedTopic.id, kind: 'topic' }],
          signature: normalizeChatTopicsSignature(input.signature ?? {}),
          total: 1,
        });
      }
    }

    if (!changedTopic && nextIndexes.length === 0) return;

    const existingRouting = sourceId
      ? activeProjectionRecord(projectionScope?.records.topic[sourceId])?.fragments.routing?.data
      : undefined;
    const context = input.context ?? existingRouting;

    this.#get().internal_commitProjection(scope, {
      indexes: nextIndexes,
      records: changedTopic
        ? [
            chatTopicRecord(changedTopic, observation, {
              agentId: context?.agentId,
              groupId: context?.groupId,
              withDetails,
            }),
          ]
        : undefined,
      tombstones:
        payload.type === 'replaceTopicId' && payload.id !== payload.nextId
          ? [{ id: payload.id, kind: 'topic', observedAt }]
          : undefined,
    });
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
