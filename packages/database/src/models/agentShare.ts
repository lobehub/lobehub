import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, exists, isNull, sql } from 'drizzle-orm';

import type { AgentShareConfig } from '../schemas';
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
    config?.maxTopicsPerVisitor ?? DEFAULT_AGENT_SHARE_CONFIG.maxTopicsPerVisitor,
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

  private findOwnedAgent = async (agentId: string) => {
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(eq(agents.id, agentId), eq(agents.userId, this.userId), isNull(agents.workspaceId)),
      )
      .limit(1);

    return agent ?? null;
  };

  /** Create a private share by default, or return the existing share for the agent. */
  create = async (agentId: string, visibility: ShareVisibility = 'private') => {
    const agent = await this.findOwnedAgent(agentId);

    if (!agent) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Agent sharing is only available to personal agent owners',
      });
    }

    const [created] = await this.db
      .insert(agentShares)
      .values({ agentId, shareConfig: DEFAULT_AGENT_SHARE_CONFIG, visibility })
      .onConflictDoNothing({ target: agentShares.agentId })
      .returning();

    return created ?? this.getByAgentId(agentId);
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

  /** Replace the complete share configuration. */
  updateConfig = async (agentId: string, config: AgentShareConfig) => {
    const [updated] = await this.db
      .update(agentShares)
      .set({ shareConfig: config, updatedAt: new Date() })
      .where(and(eq(agentShares.agentId, agentId), this.ownership()))
      .returning();

    return updated ?? null;
  };

  /** Update share visibility for a personally owned agent. */
  updateVisibility = async (agentId: string, visibility: ShareVisibility) => {
    const [updated] = await this.db
      .update(agentShares)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(agentShares.agentId, agentId), this.ownership()))
      .returning();

    return updated ?? null;
  };

  /** Disable sharing by deleting the agent's share record. */
  deleteByAgentId = async (agentId: string) => {
    const [deleted] = await this.db
      .delete(agentShares)
      .where(and(eq(agentShares.agentId, agentId), this.ownership()))
      .returning();

    return deleted ?? null;
  };

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
