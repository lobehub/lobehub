import { getAgentPersistConfig } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem, LobeAgentAgencyConfig } from '@lobechat/types';
import { pruneWorkingDirByDeviceDeletes } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import { merge } from '@/utils/merge';

import type { AgentItem } from '../schemas';
import {
  agentBotProviders,
  agentCronJobs,
  agents,
  agentsFiles,
  agentsKnowledgeBases,
  agentsToSessions,
  chatGroupsAgents,
  devices,
  documents,
  files,
  knowledgeBases,
  messages,
  sessions,
  threads,
  topics,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentMeta } from '../utils/inboxAgent';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class AgentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Rank the user's agents by topic count (agent usage ranking). Counts topics
   * directly via `topics.agentId`, so it is agent-native — no sessionId. Mirrors
   * the recents filter: real agents plus the inbox, excluding other virtual agents.
   */
  rank = async (limit: number = 10): Promise<AgentRankItem[]> => {
    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        count: count(topics.id).as('count'),
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .leftJoin(topics, eq(topics.agentId, agents.id))
      .where(and(this.ownership(), or(eq(agents.slug, INBOX_SESSION_ID), ne(agents.virtual, true))))
      .groupBy(agents.id)
      .having(({ count }) => gt(count, 0))
      .orderBy(desc(sql`count`))
      .limit(limit);

    return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
  };

  /**
   * Compat-mode ownership predicate for the `agents` table.
   * - team mode (workspaceId set): `workspace_id = ?` (every member sees the same agents)
   * - personal mode: `user_id = ? AND workspace_id IS NULL`
   */
  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents);

  /** Same predicate but for the `sessions` table (used in delete cascade). */
  private sessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, sessions);

  /** Ownership predicates for the agent join/related tables. */
  private documentsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents);

  private agentsFilesOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsFiles);

  private agentsKnowledgeBasesOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      agentsKnowledgeBases,
    );

  private agentsToSessionsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentsToSessions);

  /**
   * Collect device ids that an incoming `agencyConfig` patch is *setting*
   * (not clearing). `workingDirByDevice` entries with `undefined` value are
   * deletes (per `pruneWorkingDirByDeviceDeletes`) and are skipped.
   */
  private collectBoundDeviceIds = (
    agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
  ): string[] => {
    if (!agencyConfig) return [];
    const ids: string[] = [];
    const bound = agencyConfig.boundDeviceId;
    if (typeof bound === 'string' && bound) ids.push(bound);
    const map = agencyConfig.workingDirByDevice;
    if (map) {
      for (const [deviceId, cwd] of Object.entries(map)) {
        if (cwd === undefined) continue;
        ids.push(deviceId);
      }
    }
    return ids;
  };

  /**
   * Enforce: a workspace-scoped agent may only bind devices enrolled in the
   * same workspace. Personal devices (workspace_id IS NULL) are reachable only
   * by their owning user, so a workspace member who isn't that owner would get
   * a broken agent. Rejects at write time rather than at execution time.
   *
   * No-op when `agentWorkspaceId` is null (personal agent — any device OK) or
   * when the patch carries no new device ids.
   */
  private assertWorkspaceDeviceBinding = async (
    agentWorkspaceId: string | null,
    agencyConfig: PartialDeep<LobeAgentAgencyConfig> | null | undefined,
  ): Promise<void> => {
    if (!agentWorkspaceId) return;
    const candidates = this.collectBoundDeviceIds(agencyConfig);
    if (candidates.length === 0) return;

    const rows = await this.db
      .select({ deviceId: devices.deviceId })
      .from(devices)
      .where(and(eq(devices.workspaceId, agentWorkspaceId), inArray(devices.deviceId, candidates)));
    const allowed = new Set(rows.map((r) => r.deviceId));
    const invalid = candidates.find((id) => !allowed.has(id));
    if (invalid) {
      throw new TRPCError({
        cause: { data: { code: 'WorkspaceAgentRequiresWorkspaceDevice', deviceId: invalid } },
        code: 'FORBIDDEN',
        message:
          'Workspace agent can only bind devices enrolled in the same workspace. ' +
          'Enroll the device to the workspace, or pick a workspace device.',
      });
    }
  };

  getAgentConfigById = async (id: string) => {
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, id), this.ownership()),
    });

    if (!agent) return null;

    return this.enrichAgentWithKnowledge(agent);
  };

  existsById = async (id: string): Promise<boolean> => {
    const rows = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, id), this.ownership()))
      .limit(1);

    return rows.length > 0;
  };

  /**
   * Lightweight lookup of an agent's currently-configured model + provider,
   * used to snapshot the model into a task config so later changes to the
   * agent's default model don't silently affect already-created tasks.
   * Returns null when the agent has no model/provider set, or the agent
   * cannot be found for this user.
   */
  getAgentModelConfig = async (
    idOrSlug: string,
  ): Promise<{ model: string; provider: string } | null> => {
    const rows = await this.db
      .select({ model: agents.model, provider: agents.provider })
      .from(agents)
      .where(and(this.ownership(), or(eq(agents.id, idOrSlug), eq(agents.slug, idOrSlug))))
      .limit(1);

    const row = rows[0];
    if (!row || !row.model || !row.provider) return null;
    return { model: row.model, provider: row.provider };
  };

  /**
   * Build the where condition shared by queryAgents / countAgents:
   * non-virtual agents of the current user, with optional keyword filter.
   */
  private buildQueryAgentsWhere = (keyword?: string) => {
    // Include agents where virtual is false OR null (legacy data without virtual field)
    const baseConditions = and(
      this.ownership(),
      or(eq(agents.virtual, false), isNull(agents.virtual)),
    );

    // Add keyword search condition if provided
    return keyword
      ? and(
          baseConditions,
          or(ilike(agents.title, `%${keyword}%`), ilike(agents.description, `%${keyword}%`)),
        )
      : baseConditions;
  };

  /**
   * Query non-virtual agents with optional keyword filter.
   * Returns minimal agent info (id, title, description, avatar, backgroundColor).
   * Excludes virtual agents (like inbox, supervisors, etc).
   */
  queryAgents = async (params?: { keyword?: string; limit?: number; offset?: number }) => {
    const { keyword, limit = 9999, offset = 0 } = params ?? {};
    const searchCondition = this.buildQueryAgentsWhere(keyword);

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        description: agents.description,
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(searchCondition)
      .orderBy(desc(agents.updatedAt))
      .limit(limit)
      .offset(offset);

    return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
  };

  /**
   * Count non-virtual agents matching the same conditions as queryAgents.
   * Used to report real totals (and pagination) when queryAgents is limited.
   */
  countAgents = async (params?: { keyword?: string }): Promise<number> => {
    const result = await this.db
      .select({ count: count() })
      .from(agents)
      .where(this.buildQueryAgentsWhere(params?.keyword));

    return result[0]?.count ?? 0;
  };

  /**
   * Get minimal agent info (avatar, title, backgroundColor) by IDs.
   * For inbox agent (slug='inbox'), falls back to LobeAI defaults when avatar/title are missing.
   */
  getAgentAvatarsByIds = async (ids: string[]) => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(and(this.ownership(), inArray(agents.id, ids)));

    return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
  };

  /**
   * List agents bindable by the System Bot messenger picker: real agents plus
   * the inbox (other virtual agents excluded), ordered by `updatedAt DESC` with
   * the inbox pinned to the top.
   *
   * Title fallback is fully owned here: the inbox resolves to the LobeAI
   * default, and any other agent with a blank title resolves to
   * `options.fallbackTitle` (default `null`, so a caller that omits it can let
   * the client supply its own i18n default).
   */
  listMessengerBindableAgents = async (options?: {
    fallbackTitle?: string | null;
  }): Promise<
    Array<{
      avatar: string | null;
      backgroundColor: string | null;
      id: string;
      isInbox: boolean;
      title: string | null;
    }>
  > => {
    const fallbackTitle = options?.fallbackTitle ?? null;

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        slug: agents.slug,
        title: agents.title,
      })
      .from(agents)
      .where(and(this.ownership(), or(ne(agents.virtual, true), eq(agents.slug, INBOX_SESSION_ID))))
      .orderBy(desc(agents.updatedAt));

    const normalized = rows
      .filter((row) => row.id)
      .map(({ slug, ...row }) => {
        const meta = normalizeInboxAgentMeta(row, { slug });
        return {
          avatar: meta.avatar,
          backgroundColor: meta.backgroundColor,
          id: meta.id,
          isInbox: slug === INBOX_SESSION_ID,
          // The inbox title is already resolved by normalizeInboxAgentMeta; any
          // other blank title falls back to the caller-provided default.
          title: meta.title?.trim() || fallbackTitle,
        };
      });

    // Pin the inbox agent to the top regardless of updatedAt — it's the
    // implicit "default" agent and should always be the first option.
    const inboxIdx = normalized.findIndex((row) => row.isInbox);
    if (inboxIdx > 0) {
      const [inbox] = normalized.splice(inboxIdx, 1);
      normalized.unshift(inbox);
    }

    return normalized;
  };

  /**
   * Get agent config by ID or slug (single query with OR condition)
   */
  getAgentConfig = async (idOrSlug: string) => {
    // Prefer an exact ID match over a slug match. The combined `or(id, slug)`
    // query has no inherent ordering, so resolve ID first for determinism.
    const agent =
      (await this.db.query.agents.findFirst({
        where: and(this.ownership(), eq(agents.id, idOrSlug)),
      })) ??
      (await this.db.query.agents.findFirst({
        where: and(this.ownership(), eq(agents.slug, idOrSlug)),
      }));

    if (!agent) return null;

    return this.enrichAgentWithKnowledge(agent);
  };

  /**
   * Enrich agent with knowledge base and files data
   */
  private enrichAgentWithKnowledge = async (agent: AgentItem) => {
    const knowledge = await this.getAgentAssignedKnowledge(agent.id);
    const normalizedAgent = normalizeInboxAgentMeta(agent, { slug: agent.slug });

    // Fetch document content for enabled files
    const enabledFileIds = knowledge.files
      .filter((f) => f.enabled)
      .map((f) => f.id)
      .filter((id) => id !== undefined);
    let files: Array<(typeof knowledge.files)[number] & { content?: string | null }> =
      knowledge.files;

    if (enabledFileIds.length > 0) {
      const documentsData = await this.db.query.documents.findMany({
        where: and(this.documentsOwnership(), inArray(documents.fileId, enabledFileIds)),
      });

      const documentMap = new Map(documentsData.map((doc) => [doc.fileId, doc.content]));
      files = knowledge.files.map((file) => ({
        ...file,
        content: file.enabled && file.id ? documentMap.get(file.id) : undefined,
      }));
    }

    return { ...normalizedAgent, ...knowledge, files };
  };

  getAgentAssignedKnowledge = async (id: string) => {
    // Run both queries in parallel for better performance
    // Include userId check to ensure user can only access their own agent's knowledge
    const [knowledgeBaseResult, fileResult] = await Promise.all([
      this.db
        .select({ enabled: agentsKnowledgeBases.enabled, knowledgeBases })
        .from(agentsKnowledgeBases)
        .where(and(eq(agentsKnowledgeBases.agentId, id), this.agentsKnowledgeBasesOwnership()))
        .orderBy(desc(agentsKnowledgeBases.createdAt))
        .leftJoin(knowledgeBases, eq(knowledgeBases.id, agentsKnowledgeBases.knowledgeBaseId)),
      this.db
        .select({ enabled: agentsFiles.enabled, files })
        .from(agentsFiles)
        .where(and(eq(agentsFiles.agentId, id), this.agentsFilesOwnership()))
        .orderBy(desc(agentsFiles.createdAt))
        .leftJoin(files, eq(files.id, agentsFiles.fileId)),
    ]);

    return {
      files: fileResult.map((item) => ({
        ...item.files,
        enabled: item.enabled,
      })),
      knowledgeBases: knowledgeBaseResult.map((item) => ({
        ...item.knowledgeBases,
        enabled: item.enabled,
      })),
    };
  };

  /**
   * Find agent by session id
   */
  findBySessionId = async (sessionId: string) => {
    const item = await this.db.query.agentsToSessions.findFirst({
      where: and(eq(agentsToSessions.sessionId, sessionId), this.agentsToSessionsOwnership()),
    });

    if (!item) return;

    const agentId = item.agentId;

    return this.getAgentConfigById(agentId);
  };

  createAgentKnowledgeBase = async (
    agentId: string,
    knowledgeBaseId: string,
    enabled: boolean = true,
  ) => {
    return this.db
      .insert(agentsKnowledgeBases)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { agentId, enabled, knowledgeBaseId },
        ),
      );
  };

  deleteAgentKnowledgeBase = async (agentId: string, knowledgeBaseId: string) => {
    return this.db
      .delete(agentsKnowledgeBases)
      .where(
        and(
          eq(agentsKnowledgeBases.agentId, agentId),
          eq(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
          this.agentsKnowledgeBasesOwnership(),
        ),
      );
  };

  toggleKnowledgeBase = async (agentId: string, knowledgeBaseId: string, enabled?: boolean) => {
    return this.db
      .update(agentsKnowledgeBases)
      .set({ enabled })
      .where(
        and(
          eq(agentsKnowledgeBases.agentId, agentId),
          eq(agentsKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
          this.agentsKnowledgeBasesOwnership(),
        ),
      );
  };

  createAgentFiles = async (agentId: string, fileIds: string[], enabled: boolean = true) => {
    // Exclude the fileIds that already exist in agentsFiles, and then insert them
    const existingFiles = await this.db
      .select({ id: agentsFiles.fileId })
      .from(agentsFiles)
      .where(
        and(
          eq(agentsFiles.agentId, agentId),
          this.agentsFilesOwnership(),
          inArray(agentsFiles.fileId, fileIds),
        ),
      );

    const existingFilesIds = new Set(existingFiles.map((item) => item.id));

    const needToInsertFileIds = fileIds.filter((fileId) => !existingFilesIds.has(fileId));

    if (needToInsertFileIds.length === 0) return;

    return this.db
      .insert(agentsFiles)
      .values(
        needToInsertFileIds.map((fileId) =>
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            { agentId, enabled, fileId },
          ),
        ),
      );
  };

  deleteAgentFile = async (agentId: string, fileId: string) => {
    return this.db
      .delete(agentsFiles)
      .where(
        and(
          eq(agentsFiles.agentId, agentId),
          eq(agentsFiles.fileId, fileId),
          this.agentsFilesOwnership(),
        ),
      );
  };

  /**
   * Delete an agent and its associated session.
   * This will cascade delete messages, topics, etc. through the session deletion.
   */
  delete = async (agentId: string) => {
    return this.db.transaction(async (trx) => {
      // 1. Get associated session IDs
      const links = await trx
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()));

      const sessionIds = links.map((link) => link.sessionId);

      // 2. Delete links in agentsToSessions
      await trx
        .delete(agentsToSessions)
        .where(and(eq(agentsToSessions.agentId, agentId), this.agentsToSessionsOwnership()));

      // 3. Delete associated sessions (this will cascade delete messages, topics, etc.)
      if (sessionIds.length > 0) {
        await trx
          .delete(sessions)
          .where(and(inArray(sessions.id, sessionIds), this.sessionsOwnership()));
      }

      // 4. Delete the agent itself
      return trx.delete(agents).where(and(eq(agents.id, agentId), this.ownership()));
    });
  };

  /**
   * Batch delete agents by IDs.
   * This is a simpler delete that only removes the agent records.
   * Use this for virtual agents that don't have associated sessions.
   */
  batchDelete = async (agentIds: string[]) => {
    if (agentIds.length === 0) return;

    return this.db.delete(agents).where(and(this.ownership(), inArray(agents.id, agentIds)));
  };

  toggleFile = async (agentId: string, fileId: string, enabled?: boolean) => {
    return this.db
      .update(agentsFiles)
      .set({ enabled })
      .where(
        and(
          eq(agentsFiles.agentId, agentId),
          eq(agentsFiles.fileId, fileId),
          this.agentsFilesOwnership(),
        ),
      );
  };

  /**
   * Create an agent record only (without creating a session).
   * This is used for creating virtual agents (e.g., group chat members).
   */
  create = async (config: Partial<AgentItem>): Promise<AgentItem> => {
    await this.assertWorkspaceDeviceBinding(this.workspaceId ?? null, config.agencyConfig);

    const [result] = await this.db
      .insert(agents)
      .values([
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            ...config,
            model: typeof config.model === 'string' ? config.model : null,
          },
        ),
      ])
      .returning();

    return result;
  };

  /**
   * Batch create multiple agents (without sessions).
   * Used for creating multiple virtual agents at once (e.g., group chat members).
   */
  batchCreate = async (configs: Partial<AgentItem>[]): Promise<AgentItem[]> => {
    if (configs.length === 0) return [];

    return this.db
      .insert(agents)
      .values(
        configs.map((config) =>
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              ...config,
              model: typeof config.model === 'string' ? config.model : null,
            },
          ),
        ),
      )
      .returning();
  };

  update = async (agentId: string, data: Partial<AgentItem>) => {
    return this.db
      .update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), this.ownership()));
  };

  touchUpdatedAt = async (agentId: string) => {
    return this.update(agentId, {});
  };

  /**
   * Check if an agent with the given marketIdentifier already exists
   * @returns true if exists, false otherwise
   */
  checkByMarketIdentifier = async (marketIdentifier: string): Promise<boolean> => {
    const result = await this.db.query.agents.findFirst({
      where: and(eq(agents.marketIdentifier, marketIdentifier), this.ownership()),
    });
    return !!result;
  };

  /**
   * Get an agent by marketIdentifier
   * If multiple agents match, returns the most recently updated one
   * @returns agent id if exists, null otherwise
   */
  getAgentByMarketIdentifier = async (marketIdentifier: string): Promise<string | null> => {
    const result = await this.db.query.agents.findFirst({
      columns: { id: true },
      orderBy: (agents, { desc }) => [desc(agents.updatedAt)],
      where: and(eq(agents.marketIdentifier, marketIdentifier), this.ownership()),
    });
    return result?.id ?? null;
  };

  /**
   * Get an agent by the forkedFromIdentifier stored in params
   * @param forkedFromIdentifier - The source agent's market identifier
   * @returns agent id if exists, null otherwise
   */
  getAgentByForkedFromIdentifier = async (forkedFromIdentifier: string): Promise<string | null> => {
    const result = await this.db.query.agents.findFirst({
      columns: { id: true },
      orderBy: (agents, { desc }) => [desc(agents.updatedAt)],
      where: and(
        this.ownership(),
        sql`${agents.params}->>'forkedFromIdentifier' = ${forkedFromIdentifier}`,
      ),
    });
    return result?.id ?? null;
  };

  updateConfig = async (agentId: string, data: PartialDeep<AgentItem> | undefined | null) => {
    if (!data || Object.keys(data).length === 0) return;

    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), this.ownership()),
    });

    if (!agent) return;

    await this.assertWorkspaceDeviceBinding(agent.workspaceId, data.agencyConfig);

    // First process the params field: undefined means delete, null means disable flag
    const existingParams = agent.params ?? {};
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
    const mergedValue = merge(agent, restData);

    // Apply the processed parameters
    mergedValue.params = Object.keys(updatedParams).length > 0 ? updatedParams : undefined;

    // agencyConfig.workingDirByDevice: a per-device entry is cleared by sending
    // `undefined`, which merge() skips — prune those keys so the delete persists.
    pruneWorkingDirByDeviceDeletes(mergedValue.agencyConfig, data.agencyConfig);

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

    // Remove timestamp fields to let Drizzle's $onUpdate handle them automatically

    const { updatedAt: _, accessedAt: __, createdAt: ___, ...updateData } = mergedValue;

    return this.db
      .update(agents)
      .set(updateData)
      .where(and(eq(agents.id, agentId), this.ownership()));
  };

  /**
   * Update the sessionGroupId for an agent
   */
  updateSessionGroupId = async (agentId: string, sessionGroupId: string | null) => {
    const result = await this.db
      .update(agents)
      .set({ sessionGroupId, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), this.ownership()))
      .returning();

    return result[0];
  };

  /**
   * Duplicate an agent.
   * Returns the new agent ID.
   */
  duplicate = async (agentId: string, newTitle?: string): Promise<{ agentId: string } | null> => {
    // Get the source agent
    const sourceAgent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, agentId), this.ownership()),
    });

    if (!sourceAgent) return null;

    // Create new agent with explicit include fields
    const [newAgent] = await this.db
      .insert(agents)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            avatar: sourceAgent.avatar,
            backgroundColor: sourceAgent.backgroundColor,
            chatConfig: sourceAgent.chatConfig,
            description: sourceAgent.description,
            fewShots: sourceAgent.fewShots,
            model: sourceAgent.model,
            openingMessage: sourceAgent.openingMessage,
            openingQuestions: sourceAgent.openingQuestions,
            params: sourceAgent.params,
            pinned: sourceAgent.pinned,
            // Config
            plugins: sourceAgent.plugins,
            provider: sourceAgent.provider,

            // Session group
            sessionGroupId: sourceAgent.sessionGroupId,
            systemRole: sourceAgent.systemRole,

            tags: sourceAgent.tags,
            // Metadata
            title: newTitle || (sourceAgent.title ? `${sourceAgent.title} (Copy)` : 'Copy'),
            tts: sourceAgent.tts,
          },
        ),
      )
      .returning();

    return { agentId: newAgent.id };
  };

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * Builtin agents are standalone agents not bound to sessions.
   *
   */
  getBuiltinAgent = async (slug: string): Promise<AgentItem | null> => {
    // 1. First try to find existing agent by slug
    const existing = await this.db.query.agents.findFirst({
      where: and(eq(agents.slug, slug), this.ownership()),
    });

    if (existing) return normalizeInboxAgentMeta(existing, { slug: existing.slug });

    // For inbox agent, it has special compatibility handling:
    // Historical inbox was stored as session with slug='inbox' and linked agent via agentsToSessions
    // If found, update the agent's slug to 'inbox' for future direct queries
    if (slug === INBOX_SESSION_ID) {
      // Use join query for better performance instead of multiple findFirst calls
      const result = await this.db
        .select({ agent: agents })
        .from(sessions)
        .innerJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
        .innerJoin(agents, eq(agentsToSessions.agentId, agents.id))
        .where(and(eq(sessions.slug, INBOX_SESSION_ID), this.sessionsOwnership()))
        .limit(1);

      if (result.length > 0 && result[0].agent) {
        // Update the agent's slug to 'inbox' for future direct queries
        // Use both id and userId to ensure we only update current user's agent
        const [updatedAgent] = await this.db
          .update(agents)
          .set({ slug: INBOX_SESSION_ID, virtual: true })
          .where(eq(agents.id, result[0].agent.id))
          .returning();

        return normalizeInboxAgentMeta(updatedAgent, { slug: updatedAgent.slug });
      }
    }

    // 3. Check if this is a known builtin agent
    const persistConfig = getAgentPersistConfig(slug);
    if (!persistConfig) return null;

    // 4. Create the builtin agent with persist config.
    // Idempotent under concurrent callers: two parallel requests for the same
    // (userId, slug) both see no existing row and race to insert. Without
    // `onConflictDoNothing`, the loser hits the `agents_slug_user_id_unique`
    // constraint; with it, the loser's `.returning()` is empty and we re-read
    // the row that won.
    // Bare `onConflictDoNothing()` (no target) does NOT pin an arbiter index,
    // so it works whether `agents_slug_user_id_unique` is the legacy full
    // unique or the migration-0109 partial (WHERE workspace_id IS NULL) — this
    // is the transition-safe form while 0109 rolls out. Tighten back to a
    // partitioned { target, where } once 0109 has flipped the index in every
    // environment. Payload still carries workspaceId so workspace-scoped
    // builtin agents land in the right workspace.
    const result = await this.db
      .insert(agents)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          {
            model: persistConfig.model,
            provider: persistConfig.provider,
            slug: persistConfig.slug,
            virtual: true,
          },
        ),
      )
      .onConflictDoNothing()
      .returning();

    if (result[0]) return normalizeInboxAgentMeta(result[0], { slug: result[0].slug });

    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.slug, slug), this.ownership()),
    });

    return agent ? normalizeInboxAgentMeta(agent, { slug: agent.slug }) : null;
  };

  /**
   * Transfer an agent and all its associated data to a different workspace or personal account.
   * Runs in a single transaction to ensure atomicity.
   */
  transferAgent = async (
    agentId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<{ agentId: string; slug: string | null }> => {
    return this.db.transaction(async (trx) => {
      // 1. Verify agent exists and belongs to current scope
      const agent = await trx.query.agents.findFirst({
        where: and(eq(agents.id, agentId), this.ownership()),
      });
      if (!agent) throw new Error('Agent not found');

      // 2. Handle slug conflict in target scope
      let slug = agent.slug;
      if (slug) {
        const buildConflictCheck = (candidate: string) =>
          targetWorkspaceId
            ? and(eq(agents.slug, candidate), eq(agents.workspaceId, targetWorkspaceId))
            : and(
                eq(agents.slug, candidate),
                eq(agents.userId, targetUserId),
                isNull(agents.workspaceId),
              );

        const existing = await trx.query.agents.findFirst({
          where: buildConflictCheck(slug),
        });
        if (existing) {
          let suffix = 1;
          while (suffix < 100) {
            const candidate = `${slug}-${suffix}`;
            const conflict = await trx.query.agents.findFirst({
              where: buildConflictCheck(candidate),
            });
            if (!conflict) {
              slug = candidate;
              break;
            }
            suffix++;
          }
        }
      }

      // 3. Build ownership update payload
      const ownershipUpdate = {
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      };

      // 3a. Strip stale device bindings when moving INTO a workspace: any
      // boundDeviceId / workingDirByDevice entry that isn't enrolled in the
      // target workspace is silently dropped. Otherwise the moved agent would
      // reference a device only the previous owner can reach. Moving to a
      // personal scope (`targetWorkspaceId === null`) keeps existing bindings.
      let nextAgencyConfig: LobeAgentAgencyConfig | null = agent.agencyConfig ?? null;
      if (targetWorkspaceId && nextAgencyConfig) {
        const candidateIds = this.collectBoundDeviceIds(nextAgencyConfig);
        if (candidateIds.length > 0) {
          const rows = await trx
            .select({ deviceId: devices.deviceId })
            .from(devices)
            .where(
              and(
                eq(devices.workspaceId, targetWorkspaceId),
                inArray(devices.deviceId, candidateIds),
              ),
            );
          const allowed = new Set(rows.map((r) => r.deviceId));
          const cleaned: LobeAgentAgencyConfig = { ...nextAgencyConfig };
          if (cleaned.boundDeviceId && !allowed.has(cleaned.boundDeviceId)) {
            delete cleaned.boundDeviceId;
          }
          if (cleaned.workingDirByDevice) {
            const filtered: Record<string, string> = {};
            for (const [deviceId, cwd] of Object.entries(cleaned.workingDirByDevice)) {
              if (allowed.has(deviceId) && typeof cwd === 'string') filtered[deviceId] = cwd;
            }
            cleaned.workingDirByDevice = Object.keys(filtered).length > 0 ? filtered : undefined;
          }
          nextAgencyConfig = cleaned;
        }
      }

      // 4. Update the agent record
      await trx
        .update(agents)
        .set({
          ...ownershipUpdate,
          agencyConfig: nextAgencyConfig,
          slug,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId));

      // 5. Update sessions linked via agentsToSessions
      const links = await trx
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(eq(agentsToSessions.agentId, agentId));

      const sessionIds = links.map((l) => l.sessionId);

      if (sessionIds.length > 0) {
        await trx.update(sessions).set(ownershipUpdate).where(inArray(sessions.id, sessionIds));
      }

      await trx
        .update(agentsToSessions)
        .set(ownershipUpdate)
        .where(eq(agentsToSessions.agentId, agentId));

      // 6. Update topics (linked via sessionId or agentId)
      const topicCondition =
        sessionIds.length > 0
          ? or(inArray(topics.sessionId, sessionIds), eq(topics.agentId, agentId))
          : eq(topics.agentId, agentId);
      await trx.update(topics).set(ownershipUpdate).where(topicCondition!);

      // 7. Update messages (linked via sessionId or agentId)
      const messageCondition =
        sessionIds.length > 0
          ? or(inArray(messages.sessionId, sessionIds), eq(messages.agentId, agentId))
          : eq(messages.agentId, agentId);
      await trx.update(messages).set(ownershipUpdate).where(messageCondition!);

      // 8. Update threads (linked via agentId)
      await trx.update(threads).set(ownershipUpdate).where(eq(threads.agentId, agentId));

      // 9. Update agent files associations
      await trx.update(agentsFiles).set(ownershipUpdate).where(eq(agentsFiles.agentId, agentId));

      // 10. Update agent knowledge base associations
      await trx
        .update(agentsKnowledgeBases)
        .set(ownershipUpdate)
        .where(eq(agentsKnowledgeBases.agentId, agentId));

      // 11. Update agent cron jobs
      await trx
        .update(agentCronJobs)
        .set(ownershipUpdate)
        .where(eq(agentCronJobs.agentId, agentId));

      // 12. Update agent bot providers (transfer, not delete)
      await trx
        .update(agentBotProviders)
        .set(ownershipUpdate)
        .where(eq(agentBotProviders.agentId, agentId));

      // 13. Remove chat group associations (groups belong to source workspace context)
      await trx.delete(chatGroupsAgents).where(eq(chatGroupsAgents.agentId, agentId));

      return { agentId, slug };
    });
  };
}
