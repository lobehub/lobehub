import { DEFAULT_AGENT_CONFIG, DEFAULT_INBOX_AVATAR, INBOX_SESSION_ID } from '@lobechat/const';
import type {
  ChatSessionList,
  LobeAgentConfig,
  LobeAgentSession,
  LobeGroupSession,
  SessionRankItem,
} from '@lobechat/types';
import type { Column } from 'drizzle-orm';
import { and, asc, count, desc, eq, gt, inArray, isNull, like, not, or, sql } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';

import type { AgentItem, NewAgent, NewSession, SessionItem } from '../schemas';
import { agents, agentsToSessions, sessionGroups, sessions, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../utils/genWhere';
import { idGenerator } from '../utils/idGenerator';

export class SessionModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }
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
      .where(and(eq(sessions.userId, this.userId), not(eq(sessions.slug, INBOX_SESSION_ID))))
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

  queryWithGroups = async (): Promise<ChatSessionList> => {
    // Query all sessions
    const result = await this.query();

    const groups = await this.db.query.sessionGroups.findMany({
      orderBy: [asc(sessionGroups.sort), desc(sessionGroups.createdAt)],
      where: eq(sessions.userId, this.userId),
    });

    const mappedSessions = result.map((item) => this.mapSessionItem(item as any));

    return {
      sessionGroups: groups as unknown as ChatSessionList['sessionGroups'],
      sessions: mappedSessions,
    };
  };

  queryByKeyword = async (keyword: string) => {
    if (!keyword) return [];

    const keywordLowerCase = keyword.toLowerCase();

    const data = await this.findSessionsByKeywords({ keyword: keywordLowerCase });

    return data.map((item) => this.mapSessionItem(item as any));
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
          eq(sessions.userId, this.userId),
        ),
      )
      .leftJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
      .leftJoin(agents, eq(agentsToSessions.agentId, agents.id))
      .leftJoin(sessionGroups, eq(sessions.groupId, sessionGroups.id))
      .limit(1);

    if (!result || !result[0]) return;

    return { ...result[0].session, agent: result[0].agent, group: result[0].group } as any;
  };

  count = async (params?: {
    endDate?: string;
    range?: [string, string];
    startDate?: string;
  }): Promise<number> => {
    const result = await this.db
      .select({
        count: count(sessions.id),
      })
      .from(sessions)
      .where(
        genWhere([
          eq(sessions.userId, this.userId),
          params?.range
            ? genRangeWhere(params.range, sessions.createdAt, (date) => date.toDate())
            : undefined,
          params?.endDate
            ? genEndDateWhere(params.endDate, sessions.createdAt, (date) => date.toDate())
            : undefined,
          params?.startDate
            ? genStartDateWhere(params.startDate, sessions.createdAt, (date) => date.toDate())
            : undefined,
        ]),
      );

    return result[0].count;
  };

  _rank = async (limit: number = 10): Promise<SessionRankItem[]> => {
    return this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        count: count(topics.id).as('count'),
        id: sessions.id,
        title: agents.title,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, this.userId)))
      .leftJoin(topics, eq(sessions.id, topics.sessionId))
      .leftJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
      .leftJoin(agents, eq(agentsToSessions.agentId, agents.id))
      .groupBy(sessions.id, agentsToSessions.agentId, agents.id)
      .having(({ count }) => gt(count, 0))
      .orderBy(desc(sql`count`))
      .limit(limit);
  };

  // TODO: In the future, once Inbox ID is stored in the database, we can directly use the _rank method
  rank = async (limit: number = 10): Promise<SessionRankItem[]> => {
    const inboxResult = await this.db
      .select({
        count: count(topics.id).as('count'),
      })
      .from(topics)
      .where(and(eq(topics.userId, this.userId), isNull(topics.sessionId)));

    const inboxCount = inboxResult[0].count;

    if (!inboxCount || inboxCount === 0) return this._rank(limit);

    const result = await this._rank(limit ? limit - 1 : undefined);

    return [
      {
        avatar: DEFAULT_INBOX_AVATAR,
        backgroundColor: null,
        count: inboxCount,
        id: INBOX_SESSION_ID,
        title: 'inbox.title',
      },
      ...result,
    ].sort((a, b) => b.count - a.count);
  };

  hasMoreThanN = async (n: number): Promise<boolean> => {
    const result = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, this.userId))
      .limit(n + 1);

    return result.length > n;
  };

  // **************** Create *************** //

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
        const existResult = await trx.query.sessions.findFirst({
          where: and(eq(sessions.slug, slug), eq(sessions.userId, this.userId)),
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
          .values({
            ...session,
            createdAt: new Date(),
            id,
            slug,
            type,
            updatedAt: new Date(),
            userId: this.userId,
          })
          .returning();

        return result[0];
      }

      const newAgents = await trx
        .insert(agents)
        .values({
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
          userId: this.userId,
        })
        .returning();

      const result = await trx
        .insert(sessions)
        .values({
          ...session,
          createdAt: new Date(),
          id,
          slug,
          type,
          updatedAt: new Date(),
          userId: this.userId,
        })
        .returning();

      await trx.insert(agentsToSessions).values({
        agentId: newAgents[0].id,
        sessionId: id,
        userId: this.userId,
      });

      return result[0];
    });
  };

  createInbox = async (defaultAgentConfig: PartialDeep<LobeAgentConfig>) => {
    const item = await this.db.query.sessions.findFirst({
      where: and(eq(sessions.userId, this.userId), eq(sessions.slug, INBOX_SESSION_ID)),
    });

    if (item) return;

    return await this.create({
      config: merge(DEFAULT_AGENT_CONFIG, defaultAgentConfig),
      slug: INBOX_SESSION_ID,
      type: 'agent',
    });
  };

  batchCreate = async (newSessions: NewSession[]) => {
    const sessionsToInsert = newSessions.map((s) => {
      return {
        ...s,
        id: this.genId(),
        userId: this.userId,
      };
    });

    return this.db.insert(sessions).values(sessionsToInsert);
  };

  duplicate = async (id: string, newTitle?: string) => {
    const result = await this.findByIdOrSlug(id);

    if (!result) return;

    // eslint-disable-next-line unused-imports/no-unused-vars
    const { agent, clientId, ...session } = result;
    const sessionId = this.genId();

    const { id: _, slug: __, ...config } = agent;

    return this.create({
      config: config,
      id: sessionId,
      session: {
        ...session,
        title: newTitle || session.title,
      },
      type: 'agent',
    });
  };

  // **************** Delete *************** //

  /**
   * Delete a session and its associated agent data if no longer referenced.
   */
  delete = async (id: string) => {
    return this.db.transaction(async (trx) => {
      // First get the agent IDs associated with this session
      const links = await trx
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .where(and(eq(agentsToSessions.sessionId, id), eq(agentsToSessions.userId, this.userId)));

      const agentIds = links.map((link) => link.agentId);

      // Delete links in agentsToSessions
      await trx
        .delete(agentsToSessions)
        .where(and(eq(agentsToSessions.sessionId, id), eq(agentsToSessions.userId, this.userId)));

      // Delete the session (this will cascade delete messages, topics, etc.)
      const result = await trx
        .delete(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, this.userId)));

      // Delete orphaned agents
      await this.clearOrphanAgent(agentIds, trx);

      return result;
    });
  };

  /**
   * Batch delete sessions and their associated agent data if no longer referenced.
   */
  batchDelete = async (ids: string[]) => {
    if (ids.length === 0) return { count: 0 };

    return this.db.transaction(async (trx) => {
      // Get agent IDs associated with these sessions
      const links = await trx
        .select({ agentId: agentsToSessions.agentId })
        .from(agentsToSessions)
        .where(
          and(inArray(agentsToSessions.sessionId, ids), eq(agentsToSessions.userId, this.userId)),
        );

      const agentIds = [...new Set(links.map((link) => link.agentId))];

      // Delete links in agentsToSessions
      await trx
        .delete(agentsToSessions)
        .where(
          and(inArray(agentsToSessions.sessionId, ids), eq(agentsToSessions.userId, this.userId)),
        );

      // Delete the sessions
      const result = await trx
        .delete(sessions)
        .where(and(inArray(sessions.id, ids), eq(sessions.userId, this.userId)));

      // Delete orphaned agents
      await this.clearOrphanAgent(agentIds, trx);

      return result;
    });
  };

  /**
   * Delete all sessions and their associated agent data for this user.
   */
  deleteAll = async () => {
    return this.db.transaction(async (trx) => {
      // Delete all agentsToSessions for this user
      await trx.delete(agentsToSessions).where(eq(agentsToSessions.userId, this.userId));

      // Delete all agents that were only used by this user's sessions
      await trx.delete(agents).where(eq(agents.userId, this.userId));

      // Delete all sessions for this user
      return trx.delete(sessions).where(eq(sessions.userId, this.userId));
    });
  };

  clearOrphanAgent = async (agentIds: string[], trx: any) => {
    if (agentIds.length === 0) return;

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
        .where(and(inArray(agents.id, orphanedAgentIds), eq(agents.userId, this.userId)));
    }
  };

  // **************** Update *************** //

  update = async (id: string, data: Partial<SessionItem>) => {
    return this.db
      .update(sessions)
      .set(data)
      .where(and(eq(sessions.id, id), eq(sessions.userId, this.userId)))
      .returning();
  };

  updateConfig = async (sessionId: string, data: PartialDeep<AgentItem> | undefined | null) => {
    if (!data || Object.keys(data).length === 0) return;

    const session = await this.findByIdOrSlug(sessionId);
    if (!session) return;

    if (!session.agent) {
      throw new Error(
        'this session is not assign with agent, please contact with admin to fix this issue.',
      );
    }

    // First process the params field: undefined means delete, null means disable flag
    const existingParams = session.agent.params ?? {};
    const updatedParams: Record<string, any> = { ...existingParams };

    if (data.params) {
      const incomingParams = data.params as Record<string, any>;
      Object.keys(incomingParams).forEach((key) => {
        const incomingValue = incomingParams[key];

        // undefined means explicitly delete this field
        if (incomingValue === undefined) {
          delete updatedParams[key];
          return;
        }

        // All other values (including null) are directly overwritten, null means disable this param on the frontend
        updatedParams[key] = incomingValue;
      });
    }

    // Build data to be merged, excluding params (processed separately)

    const { params: _params, ...restData } = data;
    const mergedValue = merge(session.agent, restData);

    // Apply the processed parameters
    mergedValue.params = Object.keys(updatedParams).length > 0 ? updatedParams : undefined;

    // Final cleanup: ensure no undefined or null values enter the database
    if (mergedValue.params) {
      const params = mergedValue.params as Record<string, any>;
      Object.keys(params).forEach((key) => {
        if (params[key] === undefined) {
          delete params[key];
        }
      });
      if (Object.keys(params).length === 0) {
        mergedValue.params = undefined;
      }
    }

    return this.db
      .update(agents)
      .set(mergedValue)
      .where(and(eq(agents.id, session.agent.id), eq(agents.userId, this.userId)));
  };

  // **************** Helper *************** //

  private genId = () => idGenerator('sessions');

  private mapSessionItem = ({
    agentsToSessions,
    title,
    backgroundColor,
    description,
    avatar,
    groupId,
    type,
    ...res
  }: SessionItem & { agentsToSessions?: { agent: AgentItem }[] }):
    | LobeAgentSession
    | LobeGroupSession => {
    const meta = {
      avatar: avatar ?? undefined,
      backgroundColor: backgroundColor ?? undefined,
      description: description ?? undefined,
      tags: undefined,
      title: title ?? undefined,
    };

    if (type === 'group') {
      // For group sessions, return without agent-specific fields
      // Transform agentsToSessions to include both relationship and agent data
      const members =
        agentsToSessions?.map((item, index) => {
          const member = {
            // Start with agent properties for compatibility
            ...item.agent,
            // Override with ChatGroupAgentItem properties
            agentId: item.agent.id,
            chatGroupId: res.id,
            enabled: true,
            order: index,
            role: 'participant',
            // Keep agent timestamps for now (could be overridden if needed)
          };
          return member;
        }) || [];

      return {
        ...res,
        group: groupId,
        members,
        meta,
        type: 'group',
      } as LobeGroupSession;
    }

    // For agent sessions, include agent-specific fields
    // TODO: Need a better implementation in the future, currently only taking the first one
    const agent = agentsToSessions?.[0]?.agent;
    return {
      ...res,
      config: agent ? (agent as any) : { model: '', plugins: [] }, // Ensure config exists for agent sessions
      group: groupId,
      meta: {
        avatar: agent?.avatar ?? avatar ?? undefined,
        backgroundColor: agent?.backgroundColor ?? backgroundColor ?? undefined,
        description: agent?.description ?? description ?? undefined,

        marketIdentifier: agent?.marketIdentifier ?? undefined,
        tags: agent?.tags ?? undefined,
        title: agent?.title ?? title ?? undefined,
      },
      model: agent?.model || '',
      type: 'agent',
    } as LobeAgentSession;
  };

  findSessionsByKeywords = async (params: {
    current?: number;
    keyword: string;
    pageSize?: number;
  }) => {
    const { keyword, pageSize = 9999, current = 0 } = params;
    const offset = current * pageSize;

    try {
      const results = await this.db.query.agents.findMany({
        limit: pageSize,
        offset,
        // Keep deterministic ordering for keyword search results
        orderBy: [asc(agents.id)],
        where: and(
          eq(agents.userId, this.userId),
          or(
            like(sql`lower(${agents.title})` as unknown as Column, `%${keyword.toLowerCase()}%`),
            like(
              sql`lower(${agents.description})` as unknown as Column,
              `%${keyword.toLowerCase()}%`,
            ),
          ),
        ),
        with: { agentsToSessions: { columns: {}, with: { session: true } } },
      });

      // Filter and map results, ensuring valid session associations
      return (
        results
          .filter((item) => item.agentsToSessions && item.agentsToSessions.length > 0)
          // @ts-expect-error
          .map((item) => item.agentsToSessions[0].session)
          .filter((session) => session !== null && session !== undefined)
      );
    } catch (e) {
      console.error('findSessionsByKeywords error:', e, { keyword });
      return [];
    }
  };
}
