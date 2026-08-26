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

interface TopicReferenceShareContext {
  agentId: string;
  visitorUserId: string;
}

class TopicReferenceExecutionRuntime {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;
  private shareContext?: TopicReferenceShareContext;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    workspaceId?: string,
    shareContext?: TopicReferenceShareContext,
  ) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.shareContext = shareContext;
  }

  /**
   * A shared-agent visitor run reads the database as the creator, so
   * ownership-only filtering on `TopicModel` is not enough to keep a topic
   * reference scoped to the visitor: it must also match the topic to this
   * specific share (visitor + agent), mirroring the same check applied to
   * automatic topic-reference injection in `buildServerCallLlmContext`.
   */
  private isTopicVisibleToRun = (
    topic: { agentId?: string | null; senderId?: string | null } | null | undefined,
  ): boolean => {
    if (!this.shareContext) return true;
    return (
      topic?.senderId === this.shareContext.visitorUserId &&
      topic?.agentId === this.shareContext.agentId
    );
  };

  getTopicContext = async (params: GetTopicContextParams): Promise<BuiltinServerRuntimeOutput> => {
    const { topicId } = params;

    if (!topicId) {
      return { content: 'topicId is required', success: false };
    }

    try {
      const topicModel = new TopicModel(this.db, this.userId, this.workspaceId);
      const topic = await topicModel.findById(topicId);

      // Same "not found" response for a missing topic and one outside the
      // visitor's scope, so this tool never leaks whether an out-of-scope
      // topic id exists on the creator's account.
      if (!topic || !this.isTopicVisibleToRun(topic)) {
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
      const messageModel = new MessageModel(this.db, this.userId, this.workspaceId);
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
    return new TopicReferenceExecutionRuntime(
      context.serverDB,
      context.userId,
      context.workspaceId,
      context.agentShare
        ? { agentId: context.agentShare.agentId, visitorUserId: context.agentShare.visitorUserId }
        : undefined,
    );
  },
  identifier: TopicReferenceIdentifier,
};
