import type { ShareAccessPermission } from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { agents, topicShares, topics } from '../schemas';
import { LobeChatDatabase } from '../type';

export class TopicShareModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Create a new share for a topic.
   * Each topic can only have one share record (enforced by unique constraint).
   */
  create = async (topicId: string, permission: ShareAccessPermission = 'private') => {
    // First verify the topic belongs to the user
    const topic = await this.db.query.topics.findFirst({
      where: and(eq(topics.id, topicId), eq(topics.userId, this.userId)),
    });

    if (!topic) {
      throw new Error('Topic not found or not owned by user');
    }

    const [result] = await this.db
      .insert(topicShares)
      .values({
        accessPermission: permission,
        topicId,
        userId: this.userId,
      })
      .returning();

    return result;
  };

  /**
   * Update share permission
   */
  updatePermission = async (topicId: string, permission: ShareAccessPermission) => {
    const [result] = await this.db
      .update(topicShares)
      .set({ accessPermission: permission, updatedAt: new Date() })
      .where(and(eq(topicShares.topicId, topicId), eq(topicShares.userId, this.userId)))
      .returning();

    return result || null;
  };

  /**
   * Delete a share by topic ID
   */
  deleteByTopicId = async (topicId: string) => {
    return this.db
      .delete(topicShares)
      .where(and(eq(topicShares.topicId, topicId), eq(topicShares.userId, this.userId)));
  };

  /**
   * Get share info by topic ID (for the owner)
   */
  getByTopicId = async (topicId: string) => {
    const result = await this.db
      .select({
        accessPermission: topicShares.accessPermission,
        id: topicShares.id,
        topicId: topicShares.topicId,
      })
      .from(topicShares)
      .where(and(eq(topicShares.topicId, topicId), eq(topicShares.userId, this.userId)))
      .limit(1);

    return result[0] || null;
  };

  /**
   * Find shared topic by share ID.
   * Returns share info including ownerId for permission checking by caller.
   * Also increments the view count.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    const result = await db
      .select({
        accessPermission: topicShares.accessPermission,
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentId: topics.agentId,
        agentTitle: agents.title,
        ownerId: topicShares.userId,
        shareId: topicShares.id,
        title: topics.title,
        topicId: topics.id,
      })
      .from(topicShares)
      .innerJoin(topics, eq(topicShares.topicId, topics.id))
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .where(eq(topicShares.id, shareId))
      .limit(1);

    // Increment view count
    if (result[0]) {
      await db
        .update(topicShares)
        .set({ viewCount: sql`${topicShares.viewCount} + 1` })
        .where(eq(topicShares.id, shareId));
    }

    return result[0] || null;
  };
}
