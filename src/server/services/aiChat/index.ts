import { type LobeChatDatabase } from '@lobechat/database';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { FileService } from '@/server/services/file';

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

  async getMessagesAndTopics(params: {
    agentId?: string;
    current?: number;
    groupId?: string;
    includeTopic?: boolean;
    pageSize?: number;
    sessionId?: string;
    threadId?: string;
    topicFilter?: {
      excludeStatuses?: string[];
      excludeTriggers?: string[];
      includeTriggers?: string[];
    };
    topicId?: string;
    /**
     * Page size cap for the topic preview list. Omit to use the model's
     * default. Callers that only need a small preview should pass a small
     * number to keep the response bounded.
     */
    topicPageSize?: number;
  }) {
    const { topicFilter, topicPageSize, ...messageParams } = params;
    const [messages, topics] = await Promise.all([
      this.messageModel.query(messageParams, {
        postProcessUrl: (path) => this.fileService.getFullFileUrl(path),
      }),
      params.includeTopic
        ? this.topicModel.query({
            agentId: params.agentId,
            groupId: params.groupId,
            ...(topicPageSize !== undefined ? { pageSize: topicPageSize } : {}),
            ...topicFilter,
          })
        : undefined,
    ]);

    return { messages, topics };
  }
}
