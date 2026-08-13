import type {
  ChatTopicMetadata,
  ChatTopicSearchIndex,
  ChatTopicSearchSignature,
  ChatTopicsIndex,
  ChatTopicStatus,
  TopicProjection,
} from '@lobechat/types';
import {
  CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX,
  CHAT_SIDEBAR_TOPICS_INDEX_PREFIX,
  chatAgentViewTopicsIndexKey,
  chatSidebarTopicsIndexKey,
  chatTopicSearchIndexKey,
} from '@lobechat/types';

import type { ChatTopic } from '@/types/topic';

import type { ProjectionScopeState } from '../../core/initialState';
import { activeProjectionRecord } from '../../core/record';

export interface ChatTopicListItemView {
  completedAt?: Date | null;
  cost?: number | null;
  createdAt?: Date | number | string;
  favorite?: boolean;
  historySummary?: string | null;
  id: string;
  metadata?: ChatTopicMetadata | null;
  model?: string | null;
  provider?: string | null;
  sessionId?: string | null;
  sortUpdatedAt?: number;
  status?: ChatTopicStatus | null;
  title: string;
  tokenUsage?: number | null;
  updatedAt: Date | number | string;
  userId?: string;
}

export interface ChatTopicDetailView extends ChatTopicListItemView {
  description: string | null;
  firstUserMessage: string | null;
  messageCount: number | null;
  trigger?: string | null;
}

export interface ChatTopicsProjectionView {
  hasMore: boolean;
  index: ChatTopicsIndex;
  items: ChatTopic[];
  total: number;
}

const activeRecord = (record: TopicProjection | undefined): TopicProjection | undefined =>
  activeProjectionRecord(record);

const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

export const selectChatTopicProjectionIds = (
  scope: ProjectionScopeState | undefined,
  filter: { agentId?: string; groupId?: string; userId?: string } = {},
): string[] => {
  if (!scope) return [];

  return Object.values(scope.records.topic).flatMap((record) => {
    const active = activeRecord(record);
    if (!active) return [];
    const routing = active.fragments.routing?.data;
    const ownership = active.fragments.ownership?.data;
    if (filter.agentId !== undefined && routing?.agentId !== filter.agentId) return [];
    if (filter.groupId !== undefined && routing?.groupId !== filter.groupId) return [];
    if (filter.userId !== undefined && ownership?.userId !== filter.userId) return [];
    return [active.id];
  });
};

export const selectChatTopicsIndex = (
  scope: ProjectionScopeState | undefined,
  surface: 'agentView' | 'sidebar',
  containerKey: string,
): ChatTopicsIndex | undefined => {
  const key =
    surface === 'agentView'
      ? chatAgentViewTopicsIndexKey(containerKey)
      : chatSidebarTopicsIndexKey(containerKey);
  return scope?.indexes[key];
};

export const selectChatTopicSearchIndex = (
  scope: ProjectionScopeState | undefined,
  signature: ChatTopicSearchSignature,
): ChatTopicSearchIndex | undefined => scope?.indexes[chatTopicSearchIndexKey(signature)];

export const selectChatTopicListItem = (
  scope: ProjectionScopeState,
  id: string,
): ChatTopicListItemView | undefined => {
  const active = activeRecord(scope.records.topic[id]);
  const fragments = active?.fragments;
  const display = fragments?.display?.data;
  const activity = fragments?.activity?.data;
  const ordering = fragments?.ordering?.data;
  const marking = fragments?.marking?.data;
  const status = fragments?.status?.data;
  const completion = fragments?.completion?.data;
  const generation = fragments?.generation?.data;
  const analytics = fragments?.analytics?.data;
  const summary = fragments?.summary?.data;
  const ownership = fragments?.ownership?.data;
  if (
    !active ||
    !display ||
    !activity ||
    !ordering ||
    !marking ||
    !status ||
    !completion ||
    !generation ||
    !analytics ||
    !summary ||
    !ownership
  )
    return undefined;

  return withoutUndefined({
    ...display,
    ...activity,
    ...ordering,
    ...marking,
    ...status,
    ...completion,
    ...generation,
    ...analytics,
    ...summary,
    ...ownership,
    sessionId: fragments?.routing?.data.sessionId,
    ...fragments?.creation?.data,
    id: active.id,
  });
};

export const selectChatTopicDetailItem = (
  scope: ProjectionScopeState,
  id: string,
): ChatTopicDetailView | undefined => {
  const base = selectChatTopicListItem(scope, id);
  const fragments = activeRecord(scope.records.topic[id])?.fragments;
  const details = fragments?.details?.data;
  const triggerInfo = fragments?.triggerInfo?.data;
  if (!base || !details || !triggerInfo) return undefined;
  return { ...base, ...details, ...triggerInfo };
};

/** Resolve the richest currently available canonical Topic view. */
export const selectChatTopicItem = (
  scope: ProjectionScopeState | undefined,
  id: string,
): ChatTopic | undefined => {
  if (!scope) return undefined;
  return (selectChatTopicDetailItem(scope, id) ?? selectChatTopicListItem(scope, id)) as
    ChatTopic | undefined;
};

/** Resolve one ordered query index into canonical Topic rows. */
export const selectChatTopicsItems = (
  scope: ProjectionScopeState | undefined,
  index: ChatTopicsIndex | undefined,
): ChatTopicListItemView[] | undefined => {
  if (!scope || !index) return undefined;
  const items: ChatTopicListItemView[] = [];
  for (const ref of index.refs) {
    const record = scope.records.topic[ref.id];
    if (record?.tombstoneAt !== undefined && record.tombstoneAt >= index.observedAt) continue;
    const item = index.signature.withDetails
      ? selectChatTopicDetailItem(scope, ref.id)
      : selectChatTopicListItem(scope, ref.id);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

export const selectChatTopicsView = (
  scope: ProjectionScopeState | undefined,
  surface: 'agentView' | 'sidebar',
  containerKey: string,
): ChatTopicsProjectionView | undefined => {
  const index = selectChatTopicsIndex(scope, surface, containerKey);
  const items = selectChatTopicsItems(scope, index);
  if (!index || !items) return undefined;

  return {
    hasMore: index.total > items.length,
    index,
    items: items as ChatTopic[],
    total: index.total,
  };
};

export const selectChatTopicSearchItems = (
  scope: ProjectionScopeState | undefined,
  signature: ChatTopicSearchSignature,
): ChatTopic[] | undefined => {
  const index = selectChatTopicSearchIndex(scope, signature);
  if (!scope || !index) return undefined;

  const items: ChatTopic[] = [];
  for (const ref of index.refs) {
    const item = selectChatTopicItem(scope, ref.id);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};

/** Find the loaded list bucket that owns a globally unique Topic id. */
export const selectChatTopicContainerKeyById = (
  scope: ProjectionScopeState | undefined,
  id: string,
): string | undefined => {
  if (!scope) return undefined;

  const indexes = Object.values(scope.indexes);
  const sidebar = indexes.find(
    (index) =>
      index?.key.startsWith(CHAT_SIDEBAR_TOPICS_INDEX_PREFIX) &&
      'refs' in index &&
      index.refs.some((ref) => ref.kind === 'topic' && ref.id === id),
  );
  if (sidebar) return sidebar.key.slice(CHAT_SIDEBAR_TOPICS_INDEX_PREFIX.length);

  const agentView = indexes.find(
    (index) =>
      index?.key.startsWith(CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX) &&
      'refs' in index &&
      index.refs.some((ref) => ref.kind === 'topic' && ref.id === id),
  );
  return agentView?.key.slice(CHAT_AGENT_VIEW_TOPICS_INDEX_PREFIX.length);
};
