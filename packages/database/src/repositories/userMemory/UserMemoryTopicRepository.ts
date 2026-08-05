import { and, asc, eq } from 'drizzle-orm';

import { messages } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildMessageScopeWhere } from '../../utils/messageScope';

/**
 * Maximum character length for the query string used in memory search
 */
const MAX_QUERY_LENGTH = 7000;

/**
 * Repository for user memory operations related to topics
 */
export class UserMemoryTopicRepository {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Get concatenated user message content for a topic, truncated to max length
   * This is used for memory retrieval based on conversation context
   *
   * @param topicId - The topic ID to get messages from
   * @returns Concatenated user message content (first 7000 chars) or null if no messages
   */
  async getUserMessagesQueryForTopic(topicId: string): Promise<string | null> {
    // Query user messages for this topic, ordered by creation time
    const userMessages = await this.db
      .select({
        content: messages.content,
      })
      .from(messages)
      .where(
        and(
          // Memory extraction only reads what THIS user wrote — user_id is the
          // author snapshot, which stays valid across agent transfers; the
          // derived predicate keeps the topic-scope check transfer-safe.
          buildMessageScopeWhere({ userId: this.userId, workspaceId: this.workspaceId }),
          eq(messages.userId, this.userId),
          eq(messages.topicId, topicId),
          eq(messages.role, 'user'),
        ),
      )
      .orderBy(asc(messages.createdAt));

    if (userMessages.length === 0) {
      return null;
    }

    // Concatenate all user message content
    const concatenatedContent = userMessages
      .map((msg) => msg.content)
      .filter((content): content is string => !!content)
      .join('\n');

    if (!concatenatedContent) {
      return null;
    }

    // Truncate to max length
    return concatenatedContent.slice(0, MAX_QUERY_LENGTH);
  }
}
