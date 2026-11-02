import { DEFAULT_AGENT_CONFIG, INBOX_SESSION_ID } from '@lobechat/const';
import type { LobeAgentConfig } from '@lobechat/types';
import { and, desc, eq, exists, inArray, not, notExists, or } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';

import type { AgentItem, NewAgent, NewSession, SessionItem } from '../schemas';
import { agents, agentsToSessions, sessionGroups, sessions } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';
import { isTrashed, notTrashed } from '../utils/softDelete';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/**
 * @deprecated Sessions are the legacy shell of an agent — see the `sessions`
 * schema note. Reads here still support legacy data and recycle-bin behavior;
 * write paths should go through `AgentModel` / `TopicModel`.
 */
export class SessionModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /** Compat scope only — used for the slug-uniqueness probe in {@link create}. */
  private scope = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, sessions);

  /**
   * Sessions carry no recycle-bin flag of their own (the agent is the
   * restorable unit), so the gate goes through the linked agents' flags.
   *
   * Write gate: a shell with *any* trashed agent linked is not updatable in
   * bulk, not hard-deletable through this model — deleting it would cascade
   * away the topics the agent's restore needs — until the agent is restored
   * (or the agent purge drops the shell with it).
   */
  private noTrashedAgent = () =>
    notExists(
      this.db
        .select({ id: agentsToSessions.agentId })
        .from(agentsToSessions)
        .innerJoin(agents, eq(agentsToSessions.agentId, agents.id))
        .where(and(eq(agentsToSessions.sessionId, sessions.id), isTrashed(agents.isDeleted))),
    );

  /**
   * Read gate: a single-agent shell whose agent sits in the bin is invisible
   * (not listed, not resolvable by id / slug, not updatable). A legacy
   * `type === 'group'` shell stays reachable while any member is live; reads
   * that join agents drop the trashed members via {@link liveAgentRow}.
   */
  private visible = () =>
    or(
      this.noTrashedAgent(),
      and(
        eq(sessions.type, 'group'),
        exists(
          this.db
            .select({ id: agentsToSessions.agentId })
            .from(agentsToSessions)
            .innerJoin(agents, eq(agentsToSessions.agentId, agents.id))
            .where(and(eq(agentsToSessions.sessionId, sessions.id), notTrashed(agents.isDeleted))),
        ),
      ),
    );

  /** For reads left-joining `agents`: drop rows of trashed members (null agent = no link, kept). */
  private liveAgentRow = () => notTrashed(agents.isDeleted);

  private ownership = () => and(this.scope(), this.visible());

  private writeOwnership = () => and(this.scope(), this.noTrashedAgent());

  private agentsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents);

  private agentsToSessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsToSessions);
  // **************** Query *************** //

  query = async ({ current = 0, pageSize = 9999 } = {}) => {
    const offset = current * pageSize;

    // Use leftJoin instead of nested with for better performance
    const result = await this.db
      .select({
        // Agent fields (from agentsToSessions join)
        agent: agents,
        // Group fields
        group: sessionGroups,
        // Session fields
        session: sessions,
      })
      .from(sessions)
      .leftJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
      .leftJoin(agents, eq(agentsToSessions.agentId, agents.id))
      .leftJoin(sessionGroups, eq(sessions.groupId, sessionGroups.id))
      .where(and(this.ownership(), this.liveAgentRow(), not(eq(sessions.slug, INBOX_SESSION_ID))))
      .orderBy(desc(sessions.updatedAt))
      .limit(pageSize)
      .offset(offset);

    // Group results by session (since leftJoin can create multiple rows per session)
    // Use Map to preserve order
    const groupedResults = new Map<string, any>();

    for (const row of result) {
      const sessionId = row.session.id;
      if (!groupedResults.has(sessionId)) {
        groupedResults.set(sessionId, {
          ...row.session,
          agentsToSessions: [],
          group: row.group,
        });
      }
      if (row.agent) {
        groupedResults.get(sessionId)!.agentsToSessions.push({ agent: row.agent });
      }
    }

    return Array.from(groupedResults.values());
  };

  findByIdOrSlug = async (
    idOrSlug: string,
  ): Promise<(SessionItem & { agent: AgentItem }) | undefined> => {
    // Use leftJoin instead of nested 'with' for better performance
    const result = await this.db
      .select({
        agent: agents,
        group: sessionGroups,
        session: sessions,
      })
      .from(sessions)
      .where(
        and(
          or(eq(sessions.id, idOrSlug), eq(sessions.slug, idOrSlug)),
          this.ownership(),
          this.liveAgentRow(),
        ),
      )
      .leftJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
      .leftJoin(agents, eq(agentsToSessions.agentId, agents.id))
      .leftJoin(sessionGroups, eq(sessions.groupId, sessionGroups.id))
      .limit(1);

    if (!result || !result[0]) return;

    return { ...result[0].session, agent: result[0].agent, group: result[0].group } as any;
  };

  hasMoreThanN = async (n: number): Promise<boolean> => {
    const result = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(this.ownership()))
      .limit(n + 1);

    return result.length > n;
  };

  // **************** Create *************** //

  /**
   * @deprecated Use AgentModel.create for creating agents directly.
   * This method creates both a session and an agent, which is the legacy pattern.
   */
  create = async ({
    id = idGenerator('sessions'),
    type = 'agent',
    session = {},
    config = {},
    slug,
  }: {
    config?: Partial<NewAgent>;
    id?: string;
    session?: Partial<NewSession>;
    slug?: string;
    type: 'agent' | 'group';
  }): Promise<SessionItem> => {
    return this.db.transaction(async (trx) => {
      if (slug) {
        // Probe with the bare scope: a shell whose agent is in the bin still
        // holds its slug (the unique index is not partial), so hiding it here
        // would make the insert below collide.
        const existResult = await trx.query.sessions.findFirst({
          where: and(eq(sessions.slug, slug), this.scope()),
        });

        if (existResult) return existResult;
      }

      // Extract and properly map fields for agent creation from DiscoverAssistantDetail
      const {
        // MetaData fields (from discover assistant)
        title,
        description,
        tags = [],
        avatar,
        backgroundColor,
        // LobeAgentConfig fields
        model,
        params,
        systemRole,
        provider,
        plugins,
        openingMessage,
        openingQuestions = [],
        // TTS config
        tts,
        // Chat config
        chatConfig,
        // Field name mapping
        examples, // maps to fewShots
        identifier, // maps to marketIdentifier
        marketIdentifier,
        // Editor data
        editorData,
      } = config as any;
      if (type === 'group') {
        const result = await trx
          .insert(sessions)
          .values(
            buildWorkspacePayload(
              { userId: this.userId, workspaceId: this.workspaceId },
              {
                ...session,
                createdAt: new Date(),
                id,
                slug,
                type,
                updatedAt: new Date(),
              },
            ),
          )
          .returning();

        return result[0];
      }

      const newAgents = await trx
        .insert(agents)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              avatar,
              backgroundColor,
              chatConfig: chatConfig || {},
              createdAt: new Date(),
              description,
              editorData: editorData || null,
              fewShots: examples || null, // Map examples to fewShots field
              id: idGenerator('agents'),
              marketIdentifier: identifier || marketIdentifier,
              model: typeof model === 'string' ? model : null,
              openingMessage,
              openingQuestions,
              params: params || {},
              plugins,
              provider,
              systemRole,
              tags,
              title,
              tts: tts || {},
              updatedAt: new Date(),
            },
          ),
        )
        .returning();

      const result = await trx
        .insert(sessions)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              ...session,
              createdAt: new Date(),
              id,
              slug,
              type,
              updatedAt: new Date(),
            },
          ),
        )
        .returning();

      await trx.insert(agentsToSessions).values({
        agentId: newAgents[0].id,
        sessionId: id,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      });

      return result[0];
    });
  };

  createInbox = async (defaultAgentConfig: PartialDeep<LobeAgentConfig>) => {
    const item = await this.db.query.sessions.findFirst({
      where: and(this.ownership(), eq(sessions.slug, INBOX_SESSION_ID)),
    });

    if (item) return;

    return await this.create({
      // `merge` returns the `@lobechat/types` LobeAgentConfig shape
      // (plugins: AgentPluginEntry[]); `create`'s `config` is the DB-layer
      // NewAgent, whose `plugins` column type is intentionally left as
      // `string[]` (only the domain types are widened for the tri-state
      // rollout, not the JSONB column's compile-time annotation).
      config: merge(DEFAULT_AGENT_CONFIG, defaultAgentConfig) as Partial<NewAgent>,
      slug: INBOX_SESSION_ID,
      type: 'agent',
    });
  };

  // **************** Delete *************** //

  /**
   * Delete a session and its associated agent data if no longer referenced.
   */
  delete = async (id: string) => {
    return this.db.transaction(async (trx) => {
      // Resolve visibility BEFORE touching the links: the recycle-bin gate is
      // evaluated through those links, so dropping them first would un-hide a
      // shell whose agent is in the bin and let the cascade take its topics.
      const [target] = await trx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, id), this.writeOwnership()))
        .limit(1);
      if (!target) return { orphanedAgentIds: [] as string[], result: { count: 0 } };

      // First get the agent IDs associated with this session
      const links = await trx
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .where(and(eq(agentsToSessions.sessionId, id), this.agentsToSessionsOwnership()));

      const agentIds = links.map((link) => link.agentId);

      // Delete links in agentsToSessions
      await trx
        .delete(agentsToSessions)
        .where(and(eq(agentsToSessions.sessionId, id), this.agentsToSessionsOwnership()));

      // Delete the session (this will cascade delete messages, topics, etc.)
      const result = await trx
        .delete(sessions)
        .where(and(eq(sessions.id, id), this.writeOwnership()));

      // Delete orphaned agents
      const orphanedAgentIds = await this.clearOrphanAgent(agentIds, trx);

      return { orphanedAgentIds, result };
    });
  };

  /**
   * Batch delete sessions and their associated agent data if no longer referenced.
   */
  batchDelete = async (ids: string[]) => {
    if (ids.length === 0) return { orphanedAgentIds: [] as string[], result: { count: 0 } };

    return this.db.transaction(async (trx) => {
      // Same ordering rule as `delete`: settle which shells are visible before
      // the links (that the visibility gate reads through) are removed.
      const visible = await trx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(inArray(sessions.id, ids), this.writeOwnership()));
      ids = visible.map((row) => row.id);
      if (ids.length === 0) return { orphanedAgentIds: [] as string[], result: { count: 0 } };

      // Get agent IDs associated with these sessions
      const links = await trx
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .where(and(inArray(agentsToSessions.sessionId, ids), this.agentsToSessionsOwnership()));

      const agentIds = [...new Set(links.map((link) => link.agentId))];

      // Delete links in agentsToSessions
      await trx
        .delete(agentsToSessions)
        .where(and(inArray(agentsToSessions.sessionId, ids), this.agentsToSessionsOwnership()));

      // Delete the sessions
      const result = await trx
        .delete(sessions)
        .where(and(inArray(sessions.id, ids), this.writeOwnership()));

      // Delete orphaned agents
      const orphanedAgentIds = await this.clearOrphanAgent(agentIds, trx);

      return { orphanedAgentIds, result };
    });
  };

  /**
   * Delete all sessions and their associated agent data for this user.
   */
  deleteAll = async () => {
    return this.db.transaction(async (trx) => {
      // Shells of trashed agents stay (their agent is still restorable); only
      // visible shells and their links go.
      const visible = await trx
        .select({ id: sessions.id })
        .from(sessions)
        .where(this.writeOwnership());
      const ids = visible.map((row) => row.id);
      if (ids.length === 0) return { count: 0 };
      await trx
        .delete(agentsToSessions)
        .where(and(inArray(agentsToSessions.sessionId, ids), this.agentsToSessionsOwnership()));
      await trx.delete(agents).where(this.agentsOwnership());
      return trx.delete(sessions).where(and(inArray(sessions.id, ids), this.scope()));
    });
  };

  clearOrphanAgent = async (agentIds: string[], trx: any): Promise<string[]> => {
    if (agentIds.length === 0) return [];

    // Batch query to find which agents still have sessions
    const remainingLinks = (await trx
      .select({ agentId: agentsToSessions.agentId })
      .from(agentsToSessions)
      .where(inArray(agentsToSessions.agentId, agentIds))) as { agentId: string }[];

    const linkedAgentIds = new Set(remainingLinks.map((link) => link.agentId));

    // Find orphaned agents (those not in the linked set)
    const orphanedAgentIds = agentIds.filter((id) => !linkedAgentIds.has(id));

    // Batch delete orphaned agents (this will cascade to agentsFiles, agentsKnowledgeBases, etc.)
    // and SET NULL on messages.agentId
    if (orphanedAgentIds.length > 0) {
      await trx
        .delete(agents)
        .where(and(inArray(agents.id, orphanedAgentIds), this.agentsOwnership()));
    }

    return orphanedAgentIds;
  };

  /**
   * Drop the legacy session shells of an agent being purged from the recycle
   * bin. Their links are already gone by then, so the trashed-agent gate no
   * longer applies; the trash handler composes this with the agent purge.
   */
  deleteShellsByIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    await this.db.delete(sessions).where(and(inArray(sessions.id, ids), this.scope()));
  };

  // **************** Update *************** //

  update = async (id: string, data: Partial<SessionItem>) => {
    return this.db
      .update(sessions)
      .set(data)
      .where(and(eq(sessions.id, id), this.ownership()))
      .returning();
  };
}
