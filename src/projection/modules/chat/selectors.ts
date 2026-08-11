import type {
  ChatTopicMetadata,
  ChatTopicsIndex,
  ChatTopicStatus,
  TopicProjection,
} from '@lobechat/types';
import { chatAgentViewTopicsIndexKey, chatSidebarTopicsIndexKey } from '@lobechat/types';

import type { ProjectionScopeState } from '../../core/initialState';

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

const activeRecord = (record: TopicProjection | undefined): TopicProjection | undefined =>
  record && !record.tombstoneAt ? record : undefined;

const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

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

/** Resolve one ordered query index into canonical Topic rows. */
export const selectChatTopicsItems = (
  scope: ProjectionScopeState | undefined,
  index: ChatTopicsIndex | undefined,
): ChatTopicListItemView[] | undefined => {
  if (!scope || !index) return undefined;
  const items: ChatTopicListItemView[] = [];
  for (const ref of index.refs) {
    const record = scope.records.topic[ref.id];
    if (record?.tombstoneAt && record.tombstoneAt >= index.observedAt) continue;
    const item = index.signature.withDetails
      ? selectChatTopicDetailItem(scope, ref.id)
      : selectChatTopicListItem(scope, ref.id);
    if (!item) return undefined;
    items.push(item);
  }
  return items;
};
