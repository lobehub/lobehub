import { INBOX_SESSION_ID } from '@/const/session';
import { lambdaClient } from '@/libs/trpc/client';
import { type BatchTaskResult } from '@/types/service';
import {
  type ChatTopic,
  type CreateTopicParams,
  type QueryTopicParams,
  type RecentTopic,
  type TopicRankItem,
} from '@/types/topic';

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
      excludeTriggers: params.excludeTriggers,
      groupId: params.groupId,
      isInbox: params.isInbox,
      pageSize: params.pageSize,
    }) as any;
  };

  getAllTopics = (): Promise<ChatTopic[]> => {
    return lambdaClient.topic.getAllTopics.query() as any;
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

  getRecentTopics = async (limit?: number): Promise<RecentTopic[]> => {
    return lambdaClient.topic.recentTopics.query({ limit });
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

  updateTopicMetadata = (
    id: string,
    metadata: { model?: string; provider?: string; workingDirectory?: string },
  ) => {
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

  removeTopic = (id: string) => {
    return lambdaClient.topic.removeTopic.mutate({ id });
  };

  removeTopics = (sessionId: string) => {
    return lambdaClient.topic.batchDeleteBySessionId.mutate({ id: this.toDbSessionId(sessionId) });
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
