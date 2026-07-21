import { INBOX_SESSION_ID } from '@/const/session';
import { lambdaClient } from '@/libs/trpc/client';
import { type BatchTaskResult } from '@/types/service';
import {
  type ChatTopic,
  type ChatTopicMetadata,
  type CreateTopicParams,
  type QueryTopicParams,
  type RecentTopic,
  type TopicRankItem,
} from '@/types/topic';

/**
 * A row from `queryTopics`. It comes straight off the `topics` table, so it
 * carries `agentId` even though `ChatTopic` doesn't declare it, plus the
 * optional last-assistant-reply preview.
 */
export interface TopicListItem extends ChatTopic {
  agentId?: string | null;
  lastAssistantMessage?: string | null;
}

export type TopicBatchDeleteScope = 'own' | 'workspace';

type OnboardingSessionMetadataPatch = Partial<NonNullable<ChatTopicMetadata['onboardingSession']>>;

type UpdateTopicMetadataInput = Omit<Partial<ChatTopicMetadata>, 'onboardingSession'> & {
  onboardingSession?: OnboardingSessionMetadataPatch;
};

export class TopicService {
  createTopic = (params: CreateTopicParams): Promise<string> => {
    return lambdaClient.topic.createTopic.mutate({
      ...params,
      sessionId: this.toDbSessionId(params.sessionId),
    });
  };

  batchCreateTopics = (importTopics: ChatTopic[]): Promise<BatchTaskResult> => {
    return lambdaClient.topic.batchCreateTopics.mutate(importTopics);
  };

  cloneTopic = (id: string, newTitle?: string): Promise<string> => {
    return lambdaClient.topic.cloneTopic.mutate({ id, newTitle });
  };

  batchMoveTopics = (topicIds: string[], targetAgentId: string) => {
    return lambdaClient.topic.batchMoveTopics.mutate({ targetAgentId, topicIds });
  };

  importTopic = (params: {
    agentId: string;
    data: string;
    groupId?: string | null;
  }): Promise<{ messageCount: number; topicId: string }> => {
    return lambdaClient.topic.importTopic.mutate(params);
  };

  getTopics = async (params: QueryTopicParams): Promise<{ items: ChatTopic[]; total: number }> => {
    return lambdaClient.topic.getTopics.query({
      agentId: params.agentId,
      current: params.current,
      excludeStatuses: params.excludeStatuses,
      excludeTriggers: params.excludeTriggers,
      groupId: params.groupId,
      includeTriggers: params.includeTriggers,
      isInbox: params.isInbox,
      pageSize: params.pageSize,
      sortBy: params.sortBy,
      triggers: params.triggers,
      withDetails: params.withDetails,
    }) as any;
  };

  queryTopics = (params?: {
    pageSize?: number;
    statuses?: string[];
    /** Pull each topic's last assistant reply (truncated) alongside the row. */
    withLastMessage?: boolean;
  }): Promise<TopicListItem[]> => {
    return lambdaClient.topic.queryTopics.query(params) as any;
  };

  countTopics = async (params?: {
    agentId?: string;
    containerId?: string | null;
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    return lambdaClient.topic.countTopics.query(params);
  };

  rankTopics = async (limit?: number): Promise<TopicRankItem[]> => {
    return lambdaClient.topic.rankTopics.query(limit);
  };

  getMaxTaskDuration = async (): Promise<number> => {
    return lambdaClient.topic.getMaxTaskDuration.query();
  };

  getRecentTopics = async (limit?: number): Promise<RecentTopic[]> => {
    return lambdaClient.topic.recentTopics.query({ limit });
  };

  hasTopicFiles = async (ids: string[]): Promise<boolean> => {
    const result = await lambdaClient.topic.hasTopicFiles.query({ ids });
    return result.data.hasFiles;
  };

  searchTopics = (keywords: string, agentId?: string, groupId?: string): Promise<ChatTopic[]> => {
    return lambdaClient.topic.searchTopics.query({
      agentId,
      groupId,
      keywords,
    }) as any;
  };

  updateTopic = (id: string, data: Partial<ChatTopic>) => {
    return lambdaClient.topic.updateTopic.mutate({ id, value: data });
  };

  updateTopicMetadata = (id: string, metadata: UpdateTopicMetadataInput) => {
    return lambdaClient.topic.updateTopicMetadata.mutate({ id, metadata });
  };

  getShareInfo = (topicId: string) => {
    return lambdaClient.topic.getShareInfo.query({ topicId });
  };

  enableSharing = (topicId: string, visibility?: 'private' | 'link') => {
    return lambdaClient.topic.enableSharing.mutate({ topicId, visibility });
  };

  updateShareVisibility = (topicId: string, visibility: 'private' | 'link') => {
    return lambdaClient.topic.updateShareVisibility.mutate({ topicId, visibility });
  };

  disableSharing = (topicId: string) => {
    return lambdaClient.topic.disableSharing.mutate({ topicId });
  };

  removeTopic = (id: string, removeFiles?: boolean) => {
    return lambdaClient.topic.removeTopic.mutate({ id, removeFiles });
  };

  removeTopics = (sessionId: string, scope: TopicBatchDeleteScope = 'own') => {
    return lambdaClient.topic.batchDeleteBySessionId.mutate({
      id: this.toDbSessionId(sessionId),
      scope,
    });
  };

  removeTopicsByAgentId = (agentId: string, scope: TopicBatchDeleteScope = 'own') => {
    return lambdaClient.topic.batchDeleteByAgentId.mutate({ agentId, scope });
  };

  removeTopicsByGroupId = (groupId: string, scope: TopicBatchDeleteScope = 'own') => {
    return lambdaClient.topic.batchDeleteByGroupId.mutate({ groupId, scope });
  };

  batchRemoveTopics = (topics: string[]) => {
    return lambdaClient.topic.batchDelete.mutate({ ids: topics });
  };

  removeAllTopic = () => {
    return lambdaClient.topic.removeAllTopics.mutate();
  };

  private toDbSessionId = (sessionId?: string | null) =>
    sessionId === INBOX_SESSION_ID ? null : sessionId;
}

export const topicService = new TopicService();
