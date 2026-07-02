import type { LobeChatDatabase } from '@lobechat/database';
import { createTimingHelpers } from '@lobechat/utils';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { FileService } from '@/server/services/file';

const { createPrefixedTimingContext, runTimedStage, toTimingContext } = createTimingHelpers(
  'lobe-server:chat:lobehub:timing',
);

interface GetMessagesAndTopicsParams {
  agentId?: string;
  current?: number;
  groupId?: string;
  includeTopic?: boolean;
  pageSize?: number;
  sessionId?: string;
  threadId?: string;
  timingRequestId?: string;
  timingStartedAt?: number;
  topicFilter?: {
    excludeStatuses?: string[];
    excludeTriggers?: string[];
    includeTriggers?: string[];
  };
  topicId?: string;
  topicPageSize?: number;
}

export class AiChatService {
  private messageModel: MessageModel;
  private fileService: FileService;
  private topicModel: TopicModel;

  constructor(serverDB: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.messageModel = new MessageModel(serverDB, userId, workspaceId);
    this.topicModel = new TopicModel(serverDB, userId, workspaceId);
    this.fileService = new FileService(serverDB, userId, workspaceId);
  }

  async getMessagesAndTopics(params: GetMessagesAndTopicsParams) {
    const { topicFilter, topicPageSize, timingRequestId, timingStartedAt, ...messageParams } =
      params;
    const timingContext = toTimingContext({ timingRequestId, timingStartedAt });
    const messageTiming = createPrefixedTimingContext(
      timingContext,
      'lambda.aiChat.messagesAndTopics.messageModel.query',
    );
    const topicTiming = createPrefixedTimingContext(
      timingContext,
      'lambda.aiChat.messagesAndTopics.topicModel.query',
    );
    const messageQueryPromise = runTimedStage(
      timingContext,
      'lambda.aiChat.messagesAndTopics.messageModel.query',
      () =>
        this.messageModel.query(messageParams, {
          postProcessUrl: (path, file) =>
            this.fileService.getFileAccessUrl({ id: file.id, url: path }),
          ...(messageTiming ? { timing: messageTiming } : {}),
        }),
      {
        hasAgentId: !!params.agentId,
        hasThreadId: !!params.threadId,
        hasTopicId: !!params.topicId,
      },
    );
    const [messages, topics] = await Promise.all([
      messageQueryPromise,
      params.includeTopic
        ? runTimedStage(
            timingContext,
            'lambda.aiChat.messagesAndTopics.topicModel.query',
            () =>
              this.topicModel.query({
                agentId: params.agentId,
                groupId: params.groupId,
                pageSize: topicPageSize,
                ...(topicTiming ? { timing: topicTiming } : {}),
                ...topicFilter,
              }),
            { hasAgentId: !!params.agentId, hasGroupId: !!params.groupId },
          )
        : undefined,
    ]);

    return { messages, topics };
  }
}
