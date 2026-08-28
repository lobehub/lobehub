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
  /**
   * The `agentShares.id` this run was authorized against. Checked alongside
   * `agentId` in `isTopicVisibleToRun` so a topic from a share instance the
   * owner has since disabled and replaced (`AgentShareModel.create()` mints a
   * new UUID every disable → re-enable cycle) is rejected even though the
   * agent still matches. See `topics.shareId`'s JSDoc
   * (`packages/database/src/schemas/topic.ts`).
   */
  shareId: string;
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
   * `TopicModel`'s ownership filter already pins reads to the ACTOR — on a
   * share run that is the visitor, whose conversations are their own rows.
   * What ownership cannot say is whether a given topic belongs to THIS share:
   * without the extra match, a visitor could `<refer_topic>` one of their own
   * private conversations (or one from a share instance the owner has since
   * taken down) into a run executing on the creator's resources. Mirrors the
   * same check applied to automatic topic-reference injection in
   * `buildServerCallLlmContext`.
   */
  private isTopicVisibleToRun = (
    topic: { agentId?: string | null; shareId?: string | null } | null | undefined,
  ): boolean => {
    if (!this.shareContext) return true;
    return (
      topic?.agentId === this.shareContext.agentId && topic?.shareId === this.shareContext.shareId
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
    const { actorUserId, delegation } = context.principal;
    if (!actorUserId) {
      throw new Error('userId is required for TopicReference execution');
    }
    // Actor-scoped, not resource-owner-scoped: topics and messages are
    // conversation rows, and on a share run those belong to the visitor.
    return new TopicReferenceExecutionRuntime(
      context.serverDB,
      actorUserId,
      context.workspaceId,
      delegation ? { agentId: delegation.agentId, shareId: delegation.shareId } : undefined,
    );
  },
  identifier: TopicReferenceIdentifier,
};
