import type { LobeChatDatabase } from '@lobechat/database';
import type { UIChatMessage } from '@lobechat/types';
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
  prefetchedMessages?: UIChatMessage[];
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
  private userId: string;
  private messageModel: MessageModel;
  private fileService: FileService;
  private topicModel: TopicModel;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.userId = userId;

    this.messageModel = new MessageModel(serverDB, userId);
    this.topicModel = new TopicModel(serverDB, userId);
    this.fileService = new FileService(serverDB, userId);
  }

  async getMessagesAndTopics(params: GetMessagesAndTopicsParams) {
    const {
      prefetchedMessages,
      topicFilter,
      topicPageSize,
      timingRequestId,
      timingStartedAt,
      ...messageParams
    } = params;
    const timingContext = toTimingContext({ timingRequestId, timingStartedAt });
    const messageTiming = createPrefixedTimingContext(
      timingContext,
      'lambda.aiChat.messagesAndTopics.messageModel.query',
    );
    const topicTiming = createPrefixedTimingContext(
      timingContext,
      'lambda.aiChat.messagesAndTopics.topicModel.query',
    );
    const messageQueryPromise = prefetchedMessages
      ? runTimedStage(
          timingContext,
          'lambda.aiChat.messagesAndTopics.messageModel.query',
          async () => prefetchedMessages,
          {
            hasAgentId: !!params.agentId,
            hasThreadId: !!params.threadId,
            hasTopicId: !!params.topicId,
            prefetched: true,
          },
        )
      : runTimedStage(
          timingContext,
          'lambda.aiChat.messagesAndTopics.messageModel.query',
          () =>
            this.messageModel.query(messageParams, {
              postProcessUrl: (path) => this.fileService.getFullFileUrl(path),
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
