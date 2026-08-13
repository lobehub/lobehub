'use client';

import type { ProjectionRequestMarker } from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import type { Key, SWRConfiguration } from 'swr';

import { topicKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import type { ChatTopic } from '@/types/topic';

import { type ProjectionQueryResponse, useProjectionRequest } from '../../query/hook';
import { useProjectionStore } from '../../store';
import { useProjectionViewHydration } from '../../views/hook';
import { chatTopicsViewContract } from './contracts';
import {
  chatTopicDetailProjectionQuery,
  chatTopicSearchProjectionQuery,
  chatTopicsPageProjectionQuery,
  type ChatTopicsPageQueryParams,
} from './queries';
import {
  selectChatTopicItem,
  selectChatTopicSearchIndex,
  selectChatTopicSearchItems,
  selectChatTopicsIndex,
  selectChatTopicsItems,
} from './selectors';

interface ChatTopicsProjectionData {
  items: ChatTopic[];
  total: number;
}

export const useChatTopicDetailProjectionRequest = (
  topicId: string | undefined,
  enabled = Boolean(topicId),
) => {
  const scope = useCacheScope();
  const data = useProjectionStore((state) => {
    if (!topicId) return undefined;
    return selectChatTopicItem(state.scopes[scope], topicId);
  }, isEqual);
  const request = useProjectionRequest(
    enabled && topicId ? topicKeys.detail(topicId) : null,
    chatTopicDetailProjectionQuery,
    { topicId: topicId ?? '' },
  );

  return { ...request, data };
};

export const useChatTopicsProjectionRequest = (
  key: Key,
  params: ChatTopicsPageQueryParams,
  enabled: boolean,
  options?: SWRConfiguration<ProjectionRequestMarker>,
): ProjectionQueryResponse<ChatTopicsProjectionData> => {
  useProjectionViewHydration(
    chatTopicsViewContract,
    {
      containerKey: params.containerKey,
      surface: params.surface,
      withDetails: params.signature.withDetails,
    },
    enabled,
  );
  const scope = useCacheScope();
  const data = useProjectionStore((state) => {
    if (!enabled) return undefined;
    const projectionScope = state.scopes[scope];
    const index = selectChatTopicsIndex(projectionScope, params.surface, params.containerKey);
    const items = selectChatTopicsItems(projectionScope, index);
    if (!index || !items) return undefined;
    return { items: items as ChatTopic[], total: index.total };
  }, isEqual);
  const request = useProjectionRequest(
    enabled ? key : null,
    chatTopicsPageProjectionQuery,
    params,
    options,
  );

  return { ...request, data };
};

export const useChatTopicSearchProjection = (
  keywords: string | undefined,
  {
    agentId,
    groupId,
  }: {
    agentId?: string;
    groupId?: string;
  } = {},
  options?: SWRConfiguration<ProjectionRequestMarker>,
): ProjectionQueryResponse<ChatTopic[]> => {
  const scope = useCacheScope();
  const signature = { agentId, groupId, keywords: keywords ?? '' };
  const enabled = Boolean(keywords);
  const data = useProjectionStore((state) => {
    if (!enabled) return undefined;
    const projectionScope = state.scopes[scope];
    if (!selectChatTopicSearchIndex(projectionScope, signature)) return undefined;
    return selectChatTopicSearchItems(projectionScope, signature);
  }, isEqual);
  const request = useProjectionRequest(
    enabled ? topicKeys.search(keywords!, scope, agentId, groupId) : null,
    chatTopicSearchProjectionQuery,
    signature,
    options,
  );

  return { ...request, data };
};
