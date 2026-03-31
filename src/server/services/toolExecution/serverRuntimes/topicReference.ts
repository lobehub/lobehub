import { TopicReferenceIdentifier } from '@lobechat/builtin-tool-topic-reference';
import type { LobeChatDatabase } from '@lobechat/database';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';

import type { ServerRuntimeRegistration } from './types';

const MAX_MESSAGES = 30;

interface GetTopicContextParams {
  topicId: string;
}

class TopicReferenceExecutionRuntime {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getTopicContext = async (params: GetTopicContextParams): Promise<BuiltinServerRuntimeOutput> => {
    const { topicId } = params;

    if (!topicId) {
      return { content: 'topicId is required', success: false };
    }

    try {
      const topicModel = new TopicModel(this.db, this.userId);
      const topic = await topicModel.findById(topicId);

      if (!topic) {
        return { content: `Topic not found: ${topicId}`, success: false };
      }

      // If topic has a summary, prefer it
      if (topic.historySummary) {
        const result = [
          `# Topic: ${topic.title || 'Untitled'}`,
          '',
          '## Summary',
          topic.historySummary,
        ].join('\n');

        return { content: result, success: true };
      }

      // Fallback: fetch recent messages
      // Must pass agentId/groupId from topic, otherwise query filters by isNull(sessionId/groupId)
      const messageModel = new MessageModel(this.db, this.userId);
      const messages = await messageModel.query({
        agentId: topic.agentId ?? undefined,
        groupId: topic.groupId ?? undefined,
        topicId,
      });

      const recentMessages = messages.slice(-MAX_MESSAGES);

      const lines = [`# Topic: ${topic.title || 'Untitled'}`, '', '## Recent Messages', ''];

      for (const msg of recentMessages) {
        const role =
          msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
        const content = (msg.content || '').trim();
        if (content) {
          lines.push(`**${role}**: ${content}`, '');
        }
      }

      return { content: lines.join('\n'), success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: `Failed to fetch topic context: ${errorMessage}`, error, success: false };
    }
  };
}

export const topicReferenceRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for TopicReference execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for TopicReference execution');
    }
    return new TopicReferenceExecutionRuntime(context.serverDB, context.userId);
  },
  identifier: TopicReferenceIdentifier,
};
