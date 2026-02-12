import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';

import { agents, chatGroups, chatGroupsAgents, topics, topicShares } from '../schemas';
import type { LobeChatDatabase } from '../type';

export type TopicShareData = NonNullable<
  Awaited<ReturnType<(typeof TopicShareModel)['findByShareId']>>
>;

export class TopicShareModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Create or get existing share for a topic.
   * Each topic can only have one share record (enforced by unique constraint).
   * If record already exists, returns the existing one.
   */
  create = async (topicId: string, visibility: ShareVisibility = 'private') => {
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
        topicId,
        userId: this.userId,
        visibility,
      })
      .onConflictDoNothing({ target: topicShares.topicId })
      .returning();

    // If conflict occurred, return existing record
    if (!result) {
      return this.getByTopicId(topicId);
    }

    return result;
  };

  /**
   * Update share visibility
   */
  updateVisibility = async (topicId: string, visibility: ShareVisibility) => {
    const [result] = await this.db
      .update(topicShares)
      .set({ updatedAt: new Date(), visibility })
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
        id: topicShares.id,
        topicId: topicShares.topicId,
        userId: topicShares.userId,
        visibility: topicShares.visibility,
      })
      .from(topicShares)
      .where(and(eq(topicShares.topicId, topicId), eq(topicShares.userId, this.userId)))
      .limit(1);

    return result[0] || null;
  };

  /**
   * Find shared topic by share ID.
   * Returns share info including ownerId for permission checking by caller.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    const result = await db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentId: topics.agentId,
        agentMarketIdentifier: agents.marketIdentifier,
        agentSlug: agents.slug,
        agentTitle: agents.title,
        groupAvatar: chatGroups.avatar,
        groupBackgroundColor: chatGroups.backgroundColor,
        groupCreatedAt: chatGroups.createdAt,
        groupId: topics.groupId,
        groupTitle: chatGroups.title,
        groupUpdatedAt: chatGroups.updatedAt,
        groupUserId: chatGroups.userId,
        ownerId: topicShares.userId,
        shareId: topicShares.id,
        title: topics.title,
        topicId: topics.id,
        visibility: topicShares.visibility,
      })
      .from(topicShares)
      .innerJoin(topics, eq(topicShares.topicId, topics.id))
      .leftJoin(agents, eq(topics.agentId, agents.id))
      .leftJoin(chatGroups, eq(topics.groupId, chatGroups.id))
      .where(eq(topicShares.id, shareId))
      .limit(1);

    if (!result[0]) return null;

    const share = result[0];

    // Fetch group members if this is a group topic
    let groupMembers:
      | {
          avatar: string | null;
          backgroundColor: string | null;
          id: string;
          title: string | null;
        }[]
      | undefined;
    if (share.groupId) {
      const members = await db
        .select({
          avatar: agents.avatar,
          backgroundColor: agents.backgroundColor,
          id: agents.id,
          title: agents.title,
        })
        .from(chatGroupsAgents)
        .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
        .where(eq(chatGroupsAgents.chatGroupId, share.groupId))
        .orderBy(asc(chatGroupsAgents.order))
        .limit(4);

      groupMembers = members;
    }

    return { ...share, groupMembers };
  };

  /**
   * Increment page view count for a share.
   * Should be called after permission check passes.
   */
  static incrementPageViewCount = async (db: LobeChatDatabase, shareId: string) => {
    await db
      .update(topicShares)
      .set({ pageViewCount: sql`${topicShares.pageViewCount} + 1` })
      .where(eq(topicShares.id, shareId));
  };

  /**
   * Find shared topic by share ID with visibility check.
   * Throws TRPCError if access is denied.
   */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    accessUserId?: string,
  ): Promise<TopicShareData> => {
    const share = await TopicShareModel.findByShareId(db, shareId);

    if (!share) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
    }

    const isOwner = accessUserId && share.ownerId === accessUserId;

    // Only check visibility for non-owners
    // 'private' - only owner can view
    // 'link' - anyone with the link can view
    if (!isOwner && share.visibility === 'private') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    return share;
  };
}
