import type { LobeChatDatabase } from '@lobechat/database';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { messages } from '@/database/schemas';
import { buildWorkspaceWhere } from '@/database/utils/workspace';

/** Generated ids are alphanumerics joined by `_` (`tpc_…`); anything else is never matched. */
const TOPIC_ID_PATTERN = /^\w+$/;

export class TopicReferenceService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  /**
   * Find one of the user's topics by id from the current scope. A workspace run can still be
   * handed one of the user's personal topic ids, so a workspace miss retries the personal scope.
   * It never reaches another workspace or another user's topics.
   */
  findTopic = async (topicId: string) => {
    const topic = await new TopicModel(this.db, this.userId, this.workspaceId).findOwnTopicById(
      topicId,
    );
    if (topic || !this.workspaceId) return topic;

    return new TopicModel(this.db, this.userId).findOwnTopicById(topicId);
  };

  /**
   * Whether `topicId` is the conversation `conversationTopicId` itself, or one a user message
   * in its main conversation names — as a bare id or inside a `<refer_topic>` tag,
   * markdown-escaped (`tpc\_…`)
   * or not. The id has to stand on its own: one that only starts a longer id does not count.
   */
  isNamedInConversation = async (conversationTopicId: string, topicId: string) => {
    if (topicId === conversationTopicId) return true;
    if (!TOPIC_ID_PATTERN.test(topicId)) return false;

    const escaped = topicId.replaceAll('_', String.raw`\\_`);
    const pattern = `(^|[^A-Za-z0-9_])(${topicId}|${escaped})([^A-Za-z0-9_]|$)`;
    const [named] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, conversationTopicId),
          eq(messages.role, 'user'),
          // Ingest persists agent-authored subagent prompts as `user` messages
          // in threads. They are not user authorization to read another topic.
          isNull(messages.threadId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages),
          sql`${messages.content} ~ ${pattern}`,
        ),
      )
      .limit(1);

    return !!named;
  };

  getTopicContext = async ({ topicId }: { topicId: string }) => {
    if (!topicId) return { content: 'topicId is required', success: false };

    const topic = await this.findTopic(topicId);

    if (!topic) return { content: `Topic not found: ${topicId}`, success: false };

    const title = topic.title || 'Untitled';
    if (topic.historySummary) {
      return { content: `# Topic: ${title}\n\n## Summary\n${topic.historySummary}`, success: true };
    }

    const messages = await new MessageModel(
      this.db,
      this.userId,
      topic.workspaceId ?? undefined,
    ).query({
      agentId: topic.agentId ?? undefined,
      groupId: topic.groupId ?? undefined,
      topicId,
    });

    const lines = [`# Topic: ${title}`, '', '## Recent Messages', ''];
    for (const message of messages.slice(-30)) {
      const role =
        message.role === 'user'
          ? 'User'
          : message.role === 'assistant'
            ? 'Assistant'
            : message.role;
      const content = (message.content || '').trim();
      if (content) lines.push(`**${role}**: ${content}`, '');
    }

    return { content: lines.join('\n'), success: true };
  };
}
