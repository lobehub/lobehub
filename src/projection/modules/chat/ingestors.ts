import type {
  ChatTopic,
  ChatTopicsIndex,
  ChatTopicsQuerySignature,
  ProjectionCommit,
  ProjectionFragment,
  ProjectionRef,
  TopicProjection,
} from '@lobechat/types';
import { chatAgentViewTopicsIndexKey, chatSidebarTopicsIndexKey } from '@lobechat/types';
import isEqual from 'fast-deep-equal';

import type { ProjectionObservation } from '../../core/ingest';

const fragment = <T>(data: T, observation: ProjectionObservation): ProjectionFragment<T> => ({
  data,
  ...observation,
});

export const normalizeChatTopicsSignature = (
  signature: ChatTopicsQuerySignature,
): ChatTopicsQuerySignature => ({
  ...(signature.excludeStatuses?.length
    ? { excludeStatuses: [...signature.excludeStatuses].sort() }
    : {}),
  ...(signature.excludeTriggers?.length
    ? { excludeTriggers: [...signature.excludeTriggers].sort() }
    : {}),
  ...(signature.isInbox ? { isInbox: true } : {}),
  ...(signature.sortBy ? { sortBy: signature.sortBy } : {}),
  ...(signature.withDetails ? { withDetails: true } : {}),
});

const timestampOf = (value: Date | number | string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
};

export const chatTopicRecord = (
  item: ChatTopic,
  observation: ProjectionObservation,
  options: { agentId?: string | null; groupId?: string | null; withDetails?: boolean } = {},
): TopicProjection => ({
  fragments: {
    activity: fragment({ updatedAt: item.updatedAt }, observation),
    analytics: fragment(
      {
        cost: item.cost,
        metadata: item.metadata,
        tokenUsage: item.tokenUsage,
      },
      observation,
    ),
    completion: fragment({ completedAt: item.completedAt }, observation),
    creation: fragment({ createdAt: item.createdAt }, observation),
    display: fragment({ title: item.title }, observation),
    generation: fragment({ model: item.model, provider: item.provider }, observation),
    marking: fragment({ favorite: item.favorite }, observation),
    ordering: fragment(
      { sortUpdatedAt: item.sortUpdatedAt ?? timestampOf(item.updatedAt) },
      observation,
    ),
    ownership: fragment({ userId: item.userId }, observation),
    status: fragment({ status: item.status }, observation),
    summary: fragment({ historySummary: item.historySummary }, observation),
    ...(options.agentId !== undefined ||
    options.groupId !== undefined ||
    item.sessionId !== undefined
      ? {
          routing: fragment(
            { agentId: options.agentId, groupId: options.groupId, sessionId: item.sessionId },
            observation,
          ),
        }
      : {}),
    ...(options.withDetails
      ? {
          details: fragment(
            {
              description: item.description ?? null,
              firstUserMessage: item.firstUserMessage ?? null,
              messageCount: item.messageCount ?? null,
            },
            observation,
          ),
          triggerInfo: fragment({ trigger: item.trigger ?? null }, observation),
        }
      : {}),
  },
  id: item.id,
  kind: 'topic',
});

export interface ChatTopicsPageInput {
  containerKey: string;
  context: { agentId?: string | null; groupId?: string | null };
  existing?: ChatTopicsIndex;
  items: ChatTopic[];
  page: number;
  pageSize: number;
  signature: ChatTopicsQuerySignature;
  surface: 'agentView' | 'sidebar';
  total: number;
}

export const ingestChatTopicsPage = (
  input: ChatTopicsPageInput,
  observation: ProjectionObservation,
): ProjectionCommit => {
  const signature = normalizeChatTopicsSignature(input.signature);
  const withDetails = Boolean(signature.withDetails);
  const pageRefs: ProjectionRef<'topic'>[] = input.items.map(({ id }) => ({ id, kind: 'topic' }));

  const existing =
    input.existing && isEqual(normalizeChatTopicsSignature(input.existing.signature), signature)
      ? input.existing
      : undefined;

  let refs = pageRefs;
  if (existing && input.page > 0) {
    const seen = new Set(existing.refs.map(({ id }) => id));
    refs = [...existing.refs, ...pageRefs.filter(({ id }) => !seen.has(id))];
  } else if (existing && existing.refs.length > pageRefs.length) {
    const pageIds = new Set(pageRefs.map(({ id }) => id));
    const cap = Math.min(Math.max(pageRefs.length, existing.refs.length), input.total);
    refs = [...pageRefs, ...existing.refs.filter(({ id }) => !pageIds.has(id))].slice(0, cap);
  }

  const key =
    input.surface === 'agentView'
      ? chatAgentViewTopicsIndexKey(input.containerKey)
      : chatSidebarTopicsIndexKey(input.containerKey);

  return {
    indexes: [
      {
        key,
        ...observation,
        persistRefLimit: input.pageSize,
        refs,
        signature,
        total: input.total,
      } as ChatTopicsIndex,
    ],
    records: input.items.map((item) =>
      chatTopicRecord(item, observation, {
        agentId: input.context.agentId ?? null,
        groupId: input.context.groupId ?? null,
        withDetails,
      }),
    ),
  };
};

export const ingestChatTopicSearchResults = (
  items: ChatTopic[],
  observation: ProjectionObservation,
): ProjectionCommit => ({
  records: items.map((item) => chatTopicRecord(item, observation)),
});
