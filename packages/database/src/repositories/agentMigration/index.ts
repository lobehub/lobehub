import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { agents, agentsToSessions, messages, sessions, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

type MigrateBySessionParams = { agentId: string; sessionId: string };
type MigrateInboxParams = { agentId: string; isInbox: true; sessionId?: string | null };
type MigrateAgentIdParams = MigrateBySessionParams | MigrateInboxParams;

/**
 * AgentMigrationRepo - handles migration of agentId for legacy data
 *
 * This repository is responsible for backfilling agentId to topics and messages
 * that were created before the agentId field was introduced.
 */
export class AgentMigrationRepo {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Runtime migration: backfill agentId for all legacy topics and messages
   * Used for progressive migration so future queries don't need agentsToSessions lookup
   *
   * This method migrates both topics and their associated messages in a transaction
   * to ensure data consistency.
   */
  migrateAgentId = async (params: MigrateAgentIdParams) => {
    return this.db.transaction(async (tx) => {
      if ('isInbox' in params && params.isInbox) {
        // Migrate inbox legacy topics and messages
        // 1. Migrate orphan legacy data (sessionId IS NULL)
        await this.migrateInbox(tx, params.agentId);
        // 2. Also migrate legacy data with associated sessionId (if exists)
        if (params.sessionId) {
          await this.migrateBySession(tx, { agentId: params.agentId, sessionId: params.sessionId });
        }
      } else {
        // Migrate session-based legacy topics and messages
        await this.migrateBySession(tx, params as MigrateBySessionParams);
      }
    });
  };

  /**
   * Migrate legacy inbox topics and their messages
   * Inbox topics have: sessionId IS NULL AND groupId IS NULL AND agentId IS NULL
   */
  private migrateInbox = async (tx: LobeChatDatabase, agentId: string) => {
    // 1. Find all legacy inbox topics that need migration
    const legacyTopics = await tx
      .select({ id: topics.id })
      .from(topics)
      .where(
        and(
          eq(topics.userId, this.userId),
          isNull(topics.sessionId),
          isNull(topics.groupId),
          isNull(topics.agentId),
        ),
      );

    if (legacyTopics.length === 0) return;

    const topicIds = legacyTopics.map((t) => t.id);

    // 2. Update topics - preserve original updatedAt to bypass $onUpdate
    await tx
      .update(topics)
      .set({ agentId, updatedAt: topics.updatedAt })
      .where(
        and(
          eq(topics.userId, this.userId),
          isNull(topics.sessionId),
          isNull(topics.groupId),
          isNull(topics.agentId),
        ),
      );

    // 3. Update associated messages that don't have agentId - preserve original updatedAt
    await tx
      .update(messages)
      .set({ agentId, updatedAt: messages.updatedAt })
      .where(
        and(
          eq(messages.userId, this.userId),
          inArray(messages.topicId, topicIds),
          isNull(messages.agentId),
        ),
      );

    // 4. Also update messages without topicId but in inbox (sessionId IS NULL) - preserve original updatedAt
    await tx
      .update(messages)
      .set({ agentId, updatedAt: messages.updatedAt })
      .where(
        and(
          eq(messages.userId, this.userId),
          isNull(messages.sessionId),
          isNull(messages.topicId),
          isNull(messages.agentId),
        ),
      );
  };

  /**
   * Migrate legacy topics and messages for a specific session
   */
  private migrateBySession = async (
    tx: LobeChatDatabase,
    { sessionId, agentId }: MigrateBySessionParams,
  ) => {
    // 1. Find all legacy topics with sessionId that need migration
    const legacyTopics = await tx
      .select({ id: topics.id })
      .from(topics)
      .where(
        and(
          eq(topics.userId, this.userId),
          eq(topics.sessionId, sessionId),
          isNull(topics.agentId),
        ),
      );

    const topicIds = legacyTopics.map((t) => t.id);

    // 2. Update topics - preserve original updatedAt to bypass $onUpdate
    await tx
      .update(topics)
      .set({ agentId, updatedAt: topics.updatedAt })
      .where(
        and(
          eq(topics.userId, this.userId),
          eq(topics.sessionId, sessionId),
          isNull(topics.agentId),
        ),
      );

    // 3. Update associated messages within these topics
    if (topicIds.length > 0) {
      await tx
        .update(messages)
        .set({ agentId, updatedAt: messages.updatedAt })
        .where(
          and(
            eq(messages.userId, this.userId),
            inArray(messages.topicId, topicIds),
            isNull(messages.agentId),
          ),
        );
    }

    // 4. Also update messages without topicId but with this sessionId
    await tx
      .update(messages)
      .set({ agentId, updatedAt: messages.updatedAt })
      .where(
        and(
          eq(messages.userId, this.userId),
          eq(messages.sessionId, sessionId),
          isNull(messages.topicId),
          isNull(messages.agentId),
        ),
      );
  };

  /**
   * Get the associated sessionId for an agent (for backward compatibility lookup)
   */
  getSessionIdByAgentId = async (agentId: string): Promise<string | null> => {
    const result = await this.db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), eq(agentsToSessions.userId, this.userId)))
      .limit(1);

    return result[0]?.sessionId ?? null;
  };

  /**
   * Runtime migration: backfill sessionGroupId for legacy agents
   *
   * This method migrates agents that have:
   * - sessionGroupId IS NULL
   * - Associated session has groupId NOT NULL
   *
   * It copies the session's groupId to the agent's sessionGroupId
   */
  migrateSessionGroupId = async () => {
    // Find all agents that need migration:
    // - Agent's sessionGroupId is NULL
    // - Agent's associated session has a groupId
    const agentsToMigrate = await this.db
      .select({
        agentId: agents.id,
        sessionGroupId: sessions.groupId,
      })
      .from(agents)
      .innerJoin(agentsToSessions, eq(agents.id, agentsToSessions.agentId))
      .innerJoin(sessions, eq(agentsToSessions.sessionId, sessions.id))
      .where(
        and(
          eq(agents.userId, this.userId),
          isNull(agents.sessionGroupId),
          isNotNull(sessions.groupId),
        ),
      );

    if (agentsToMigrate.length === 0) return;

    // Update each agent's sessionGroupId
    // Using individual updates to preserve updatedAt (no auto-update trigger)
    for (const item of agentsToMigrate) {
      if (!item.sessionGroupId) continue;

      await this.db
        .update(agents)
        .set({ sessionGroupId: item.sessionGroupId, updatedAt: agents.updatedAt })
        .where(and(eq(agents.id, item.agentId), eq(agents.userId, this.userId)));
    }
  };
}
