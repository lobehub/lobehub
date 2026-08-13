import type { ChatTopicsQuerySignature } from '@lobechat/types';

import { topicService } from '@/services/topic';

import { defineProjectionQuery } from '../../query/runtime';
import { getProjectionStoreState } from '../../store';

export interface ChatTopicDetailQueryParams {
  topicId: string;
}

type ChatTopicDetailQueryResponse = Awaited<ReturnType<typeof topicService.getTopicDetail>>;

export const chatTopicDetailProjectionQuery = defineProjectionQuery<
  ChatTopicDetailQueryParams,
  ChatTopicDetailQueryResponse
>({
  project: (topic, { observedAt, scope }) => {
    if (!topic) return;
    getProjectionStoreState().commitChatTopicRecords(
      scope,
      [topic],
      { observedAt, source: 'network' },
      { agentId: topic.sessionId, withDetails: true },
    );
  },
  query: ({ topicId }) => topicService.getTopicDetail(topicId),
});

export interface ChatTopicsPageQueryParams {
  containerKey: string;
  context: { agentId?: string | null; groupId?: string | null };
  page: number;
  pageSize: number;
  preserveIds?: string[];
  request: Parameters<typeof topicService.getTopics>[0];
  signature: ChatTopicsQuerySignature;
  surface: 'agentView' | 'sidebar';
}

type ChatTopicsPageQueryResponse = Awaited<ReturnType<typeof topicService.getTopics>>;

export const chatTopicsPageProjectionQuery = defineProjectionQuery<
  ChatTopicsPageQueryParams,
  ChatTopicsPageQueryResponse
>({
  project: (result, { observedAt, params, scope }) => {
    getProjectionStoreState().commitChatTopicsPage(
      scope,
      {
        containerKey: params.containerKey,
        context: params.context,
        items: result.items,
        page: params.page,
        pageSize: params.pageSize,
        preserveIds: params.preserveIds,
        signature: params.signature,
        surface: params.surface,
        total: result.total,
      },
      { observedAt, source: 'network' },
    );
  },
  query: ({ request }) => topicService.getTopics(request),
});

export interface ChatTopicSearchQueryParams {
  agentId?: string;
  groupId?: string;
  keywords: string;
}

type ChatTopicSearchQueryResponse = Awaited<ReturnType<typeof topicService.searchTopics>>;

export const chatTopicSearchProjectionQuery = defineProjectionQuery<
  ChatTopicSearchQueryParams,
  ChatTopicSearchQueryResponse
>({
  project: (items, { observedAt, params, scope }) => {
    getProjectionStoreState().commitChatTopicSearchResults(
      scope,
      items,
      {
        agentId: params.agentId,
        groupId: params.groupId,
        keywords: params.keywords,
      },
      { observedAt, source: 'network' },
    );
  },
  query: ({ agentId, groupId, keywords }) => topicService.searchTopics(keywords, agentId, groupId),
});
