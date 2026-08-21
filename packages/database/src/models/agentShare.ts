import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, sql } from 'drizzle-orm';

import type { AgentShareConfig, AgentShareConfigPatch } from '../schemas';
import { agents, agentShares } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar, normalizeInboxAgentTitle } from '../utils/inboxAgent';
import { isUuid } from '../utils/uuid';

const DEFAULT_AGENT_SHARE_CONFIG = {
  allowReadMemory: false,
  enabledToolIds: [],
  filePermissionConfig: {
    agentFiles: 'none',
    knowledgeBase: 'none',
    uploadAllowed: false,
  },
  maxTopicsPerVisitor: 5,
  maxTurnsPerTopic: 20,
} satisfies AgentShareConfig;

interface LegacyAgentShareConfig extends AgentShareConfig {
  /** @deprecated Renamed to maxTopicsPerVisitor. */
  maxGuestTopics?: number;
}

/** Fill fields missing from rows created before the required v1 limits were introduced. */
const normalizeAgentShareConfig = (config: AgentShareConfig | null): AgentShareConfig => ({
  allowReadMemory: config?.allowReadMemory ?? DEFAULT_AGENT_SHARE_CONFIG.allowReadMemory,
  enabledToolIds: config?.enabledToolIds ?? DEFAULT_AGENT_SHARE_CONFIG.enabledToolIds,
  filePermissionConfig: {
    agentFiles:
      config?.filePermissionConfig?.agentFiles ??
      DEFAULT_AGENT_SHARE_CONFIG.filePermissionConfig.agentFiles,
    knowledgeBase:
      config?.filePermissionConfig?.knowledgeBase ??
      DEFAULT_AGENT_SHARE_CONFIG.filePermissionConfig.knowledgeBase,
    uploadAllowed:
      config?.filePermissionConfig?.uploadAllowed ??
      DEFAULT_AGENT_SHARE_CONFIG.filePermissionConfig.uploadAllowed,
  },
  maxTopicsPerVisitor:
    config?.maxTopicsPerVisitor ??
    (config as LegacyAgentShareConfig | null)?.maxGuestTopics ??
    DEFAULT_AGENT_SHARE_CONFIG.maxTopicsPerVisitor,
  maxTurnsPerTopic: config?.maxTurnsPerTopic ?? DEFAULT_AGENT_SHARE_CONFIG.maxTurnsPerTopic,
});

export type AgentShareData = NonNullable<
  Awaited<ReturnType<(typeof AgentShareModel)['findByShareId']>>
>;

export class AgentShareModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /** Agent sharing is personal-only; workspace agents fail this predicate. */
  private ownership = () =>
    exists(
      this.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, agentShares.agentId),
            eq(agents.userId, this.userId),
            isNull(agents.workspaceId),
          ),
        ),
    );

  /** Serialize share writes with scope transfers by locking the Agent row first. */
  private withOwnedPersonalAgentLock = async <T>(
    agentId: string,
    mutation: (tx: LobeChatDatabase) => Promise<T>,
  ): Promise<T | null> =>
    this.db.transaction(async (transaction) => {
      const tx = transaction as LobeChatDatabase;
      const [agent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(eq(agents.id, agentId), eq(agents.userId, this.userId), isNull(agents.workspaceId)),
        )
        .for('update');

      if (!agent) return null;
      return mutation(tx);
    });

  /** Create a private share by default, or return the existing share for the agent. */
  create = async (agentId: string, visibility: ShareVisibility = 'private') => {
    const share = await this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [created] = await tx
        .insert(agentShares)
        .values({ agentId, shareConfig: DEFAULT_AGENT_SHARE_CONFIG, visibility })
        .onConflictDoNothing({ target: agentShares.agentId })
        .returning();

      if (created) return created;

      const [existing] = await tx
        .select()
        .from(agentShares)
        .where(eq(agentShares.agentId, agentId))
        .limit(1);
      return existing
        ? { ...existing, shareConfig: normalizeAgentShareConfig(existing.shareConfig) }
        : null;
    });

    if (!share) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Agent sharing is only available to personal agent owners',
      });
    }

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /** Get a share by agent ID for its owner. */
  getByAgentId = async (agentId: string) => {
    const [share] = await this.db
      .select()
      .from(agentShares)
      .where(and(eq(agentShares.agentId, agentId), this.ownership()))
      .limit(1);

    if (!share) return null;

    return { ...share, shareConfig: normalizeAgentShareConfig(share.shareConfig) };
  };

  /** Atomically merge client-owned fields while preserving sibling and legacy JSON keys. */
  updateConfig = async (agentId: string, config: AgentShareConfigPatch) =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const { filePermissionConfig, ...topLevelConfig } = config;
      const nextConfig = filePermissionConfig
        ? sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify(topLevelConfig)}::jsonb || jsonb_build_object('filePermissionConfig', COALESCE(${agentShares.shareConfig}->'filePermissionConfig', '{}'::jsonb) || ${JSON.stringify(filePermissionConfig)}::jsonb)`
        : sql<AgentShareConfig>`COALESCE(${agentShares.shareConfig}, '{}'::jsonb) || ${JSON.stringify(topLevelConfig)}::jsonb`;
      const [updated] = await tx
        .update(agentShares)
        .set({
          shareConfig: nextConfig,
          updatedAt: new Date(),
        })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return updated
        ? { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) }
        : null;
    });

  /** Update share visibility for a personally owned agent. */
  updateVisibility = async (agentId: string, visibility: ShareVisibility) =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [updated] = await tx
        .update(agentShares)
        .set({ updatedAt: new Date(), visibility })
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return updated
        ? { ...updated, shareConfig: normalizeAgentShareConfig(updated.shareConfig) }
        : null;
    });

  /** Disable sharing by deleting the agent's share record. */
  deleteByAgentId = async (agentId: string) =>
    this.withOwnedPersonalAgentLock(agentId, async (tx) => {
      const [deleted] = await tx
        .delete(agentShares)
        .where(eq(agentShares.agentId, agentId))
        .returning();

      return deleted ?? null;
    });

  /** Resolve the public metadata required by an agent share page. */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    if (!isUuid(shareId)) return null;

    const [share] = await db
      .select({
        agentAvatar: agents.avatar,
        agentBackgroundColor: agents.backgroundColor,
        agentDescription: agents.description,
        agentId: agentShares.agentId,
        agentMarketIdentifier: agents.marketIdentifier,
        agentName: agents.name,
        agentSlug: agents.slug,
        agentTitle: agents.title,
        ownerId: agents.userId,
        shareConfig: agentShares.shareConfig,
        shareId: agentShares.id,
        userViewCount: agentShares.userViewCount,
        visibility: agentShares.visibility,
      })
      .from(agentShares)
      .innerJoin(agents, eq(agentShares.agentId, agents.id))
      .where(and(eq(agentShares.id, shareId), isNull(agents.workspaceId)))
      .limit(1);

    if (!share) return null;

    return {
      ...share,
      agentAvatar: normalizeInboxAgentAvatar(share.agentAvatar, { slug: share.agentSlug }),
      agentTitle: normalizeInboxAgentTitle(share.agentTitle, { slug: share.agentSlug }),
      shareConfig: normalizeAgentShareConfig(share.shareConfig),
    };
  };

  /** Increment the successful page-view counter after access has been granted. */
  static incrementUserViewCount = async (db: LobeChatDatabase, shareId: string) => {
    await db
      .update(agentShares)
      .set({ userViewCount: sql`${agentShares.userViewCount} + 1` })
      .where(eq(agentShares.id, shareId));
  };

  /** Resolve a share and enforce private-share owner access. */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    accessUserId: string,
  ): Promise<AgentShareData> => {
    const share = await AgentShareModel.findByShareId(db, shareId);

    if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });

    const isOwner = accessUserId === share.ownerId;
    if (!isOwner && share.visibility === 'private') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    return share;
  };
}
