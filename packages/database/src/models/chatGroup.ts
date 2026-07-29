import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import type {
  ChatGroupAgentItem,
  ChatGroupItem,
  NewChatGroup,
  NewChatGroupAgent,
} from '../schemas';
import { agents, chatGroups, chatGroupsAgents, sessionGroups } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { normalizeInboxAgentAvatar } from '../utils/inboxAgent';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class ChatGroupModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: chatGroups.userId,
        workspaceId: chatGroups.workspaceId,
        visibility: chatGroups.visibility,
      },
    );

  /**
   * Visibility predicate on the member's `agents` row itself. Group membership
   * (the junction row) does not grant access to the agent: when a member agent
   * is switched back to private by its owner, every roster read must drop it
   * for other members — otherwise the join would keep leaking the agent's
   * config/meta through group surfaces (LOBE-11772).
   */
  private memberAgentVisibility = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: agents.userId,
        workspaceId: agents.workspaceId,
        visibility: agents.visibility,
      },
    );

  /**
   * Same guard as an EXISTS subquery, for junction queries that don't join
   * `agents`. The subquery is spelled with raw identifiers (not drizzle column
   * refs) because the relational query builder rebinds every referenced column
   * in `where` to the primary table's alias, which would corrupt the subquery.
   * Semantics mirror `buildWorkspaceWhere`.
   */
  private memberAgentVisibleExists = () => {
    if (!this.workspaceId) {
      return sql`EXISTS (SELECT 1 FROM "agents" "ma" WHERE "ma"."id" = ${chatGroupsAgents.agentId} AND "ma"."user_id" = ${this.userId} AND "ma"."workspace_id" IS NULL)`;
    }
    return sql`EXISTS (SELECT 1 FROM "agents" "ma" WHERE "ma"."id" = ${chatGroupsAgents.agentId} AND "ma"."workspace_id" = ${this.workspaceId} AND ("ma"."visibility" IS NULL OR "ma"."visibility" = 'public' OR ("ma"."visibility" = 'private' AND "ma"."user_id" = ${this.userId})))`;
  };

  /**
   * Get member avatar metas (avatar + backgroundColor) grouped by chatGroupId,
   * ordered by member order. Inbox members fall back to the default avatar.
   */
  getMemberAvatarsByGroupIds = async (
    groupIds: string[],
  ): Promise<Map<string, Array<{ avatar: string | null; backgroundColor: string | null }>>> => {
    const map = new Map<string, Array<{ avatar: string | null; backgroundColor: string | null }>>();
    if (groupIds.length === 0) return map;

    const rows = await this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        chatGroupId: chatGroupsAgents.chatGroupId,
        slug: agents.slug,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(and(inArray(chatGroupsAgents.chatGroupId, groupIds), this.memberAgentVisibility()))
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId);

    for (const { avatar, backgroundColor, chatGroupId, slug } of rows) {
      const list = map.get(chatGroupId) ?? [];
      list.push({ avatar: normalizeInboxAgentAvatar(avatar, { slug }), backgroundColor });
      map.set(chatGroupId, list);
    }

    return map;
  };

  // ******* Query Methods ******* //

  async findById(id: string): Promise<ChatGroupItem | undefined> {
    const item = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, id), this.ownership()),
    });

    return item;
  }

  async query(): Promise<ChatGroupItem[]> {
    return this.db.query.chatGroups.findMany({
      orderBy: [desc(chatGroups.updatedAt)],
      where: this.ownership(),
    });
  }

  /**
   * Get a chat group by the forkedFromIdentifier stored in config
   * @param forkedFromIdentifier - The source group's market identifier
   * @returns group id if exists, null otherwise
   */
  async getGroupByForkedFromIdentifier(forkedFromIdentifier: string): Promise<string | null> {
    const result = await this.db.query.chatGroups.findFirst({
      columns: { id: true },
      orderBy: [desc(chatGroups.updatedAt)],
      where: and(
        this.ownership(),
        sql`${chatGroups.config}->>'forkedFromIdentifier' = ${forkedFromIdentifier}`,
      ),
    });
    return result?.id ?? null;
  }

  async queryWithMemberDetails(): Promise<any[]> {
    const groups = await this.query();
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    const groupAgents = await this.db.query.chatGroupsAgents.findMany({
      where: and(
        inArray(chatGroupsAgents.chatGroupId, groupIds),
        this.agentsOwnership(),
        this.memberAgentVisibleExists(),
      ),
      with: { agent: true },
    });

    const groupAgentMap = new Map<string, any[]>();

    for (const groupAgent of groupAgents) {
      if (!groupAgent.agent) continue;

      const groupList = groupAgentMap.get(groupAgent.chatGroupId) || [];
      groupList.push(groupAgent.agent);
      groupAgentMap.set(groupAgent.chatGroupId, groupList);
    }

    return groups.map((group) => ({
      ...group,
      agents: groupAgentMap.get(group.id) || [],
    }));
  }

  async findGroupWithAgents(groupId: string): Promise<{
    agents: ChatGroupAgentItem[];
    group: ChatGroupItem;
  } | null> {
    const group = await this.findById(groupId);
    if (!group) return null;

    const agents = await this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId],
      where: and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        this.agentsOwnership(),
        this.memberAgentVisibleExists(),
      ),
    });

    return { agents, group };
  }

  // ******* Create Methods ******* //

  async create(params: Omit<NewChatGroup, 'userId'>): Promise<ChatGroupItem> {
    const [result] = await this.db
      .insert(chatGroups)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params },
        ),
      )
      .returning();

    return result;
  }

  async createWithAgents(
    groupParams: Omit<NewChatGroup, 'userId'>,
    agentIds: string[],
  ): Promise<{ agents: NewChatGroupAgent[]; group: ChatGroupItem }> {
    const group = await this.create(groupParams);

    if (agentIds.length === 0) {
      return { agents: [], group };
    }

    const agentParams: NewChatGroupAgent[] = agentIds.map((agentId, index) => ({
      agentId,
      chatGroupId: group.id,
      order: index,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    }));

    const agents = await this.db.insert(chatGroupsAgents).values(agentParams).returning();

    return { agents, group };
  }

  // ******* Update Methods ******* //

  async update(id: string, value: Partial<ChatGroupItem>): Promise<ChatGroupItem> {
    const [result] = await this.db
      .update(chatGroups)
      .set(value)
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .returning();

    if (!result) {
      throw new Error('Chat group not found or access denied');
    }

    return result;
  }

  /**
   * Publish a private chat group into the workspace. One-way: once shared,
   * other members may have started using it, so we never let it slip back to
   * `private`. Restricted to the creator's own still-private group.
   */
  async publishToWorkspace(id: string): Promise<ChatGroupItem> {
    const [result] = await this.db
      .update(chatGroups)
      .set({ updatedAt: new Date(), visibility: 'public' })
      .where(
        and(
          eq(chatGroups.id, id),
          this.ownership(),
          eq(chatGroups.userId, this.userId),
          eq(chatGroups.visibility, 'private'),
        ),
      )
      .returning();

    if (!result) {
      throw new Error('Chat group not found, already published, or access denied');
    }

    // The synthetic supervisor mirrors the group's visibility at creation
    // (private group → private supervisor). Publish it together with the
    // group, otherwise other members would receive a `supervisorAgentId`
    // whose agent row their roster reads filter out.
    await this.db
      .update(agents)
      .set({ updatedAt: new Date(), visibility: 'public' })
      .where(
        and(
          eq(agents.visibility, 'private'),
          inArray(
            agents.id,
            this.db
              .select({ id: chatGroupsAgents.agentId })
              .from(chatGroupsAgents)
              .where(
                and(eq(chatGroupsAgents.chatGroupId, id), eq(chatGroupsAgents.role, 'supervisor')),
              ),
          ),
        ),
      );

    return result;
  }

  /**
   * Bidirectional visibility switch for the Permission panel. Router-level
   * guards decide who may call this (creator-only demotion, manager/owner
   * promotion) — this method only applies the ownership-scoped write.
   *
   * Mirrors AgentModel.setVisibility: a sidebar folder cannot mix
   * visibilities, so the group is rehomed to the ungrouped section of its new
   * scope when its folder no longer matches.
   */
  async setVisibility(id: string, visibility: 'private' | 'public'): Promise<ChatGroupItem | null> {
    const [current] = await this.db
      .select({ folderVisibility: sessionGroups.visibility })
      .from(chatGroups)
      .leftJoin(sessionGroups, eq(chatGroups.groupId, sessionGroups.id))
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .limit(1);
    const folderVisibility = current?.folderVisibility as 'private' | 'public' | null | undefined;
    const clearFolder = folderVisibility != null && folderVisibility !== visibility;

    const [updated] = await this.db
      .update(chatGroups)
      .set({
        updatedAt: new Date(),
        visibility,
        ...(clearFolder ? { groupId: null } : {}),
      })
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .returning();

    if (updated) {
      // Keep the synthetic supervisor's visibility in lockstep (mirrors
      // publishToWorkspace): a promoted group must expose its supervisor to
      // members, a demoted group must not leave the supervisor public.
      await this.db
        .update(agents)
        .set({ updatedAt: new Date(), visibility })
        .where(
          and(
            ne(agents.visibility, visibility),
            inArray(
              agents.id,
              this.db
                .select({ id: chatGroupsAgents.agentId })
                .from(chatGroupsAgents)
                .where(
                  and(
                    eq(chatGroupsAgents.chatGroupId, id),
                    eq(chatGroupsAgents.role, 'supervisor'),
                  ),
                ),
            ),
          ),
        );
    }

    return updated ?? null;
  }

  async addAgentToGroup(
    groupId: string,
    agentId: string,
    options?: { order?: number; role?: string },
  ): Promise<NewChatGroupAgent> {
    const params: NewChatGroupAgent = {
      agentId,
      chatGroupId: groupId,
      order: options?.order || 0,
      role: options?.role || 'assistant',
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    };

    const [result] = await this.db.insert(chatGroupsAgents).values(params).returning();
    return result;
  }

  /**
   * Add multiple agents to a group.
   * Automatically skips agents that are already in the group.
   *
   * @returns Object containing:
   * - `added`: Agents that were newly added to the group
   * - `existing`: Agent IDs that were already in the group (skipped)
   */
  async addAgentsToGroup(
    groupId: string,
    agentIds: string[],
  ): Promise<{ added: NewChatGroupAgent[]; existing: string[] }> {
    const group = await this.findById(groupId);
    if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found' });

    // Composite visibility rule for group membership:
    // - A caller-owned private group may admit the caller's own private agents
    //   alongside public ones.
    // - Any public group, or any group the caller doesn't own, must contain
    //   only public agents — even the caller's own private agent can't be
    //   added, because that would expose it to the other members.
    // `findById` already scopes by visibility, so reaching here with
    // `group.visibility === 'private'` implies `group.userId === this.userId`.
    const allowPrivateMembers = group.visibility === 'private' && group.userId === this.userId;

    if (agentIds.length > 0) {
      // Resolve each requested agent through the workspace + visibility
      // predicate so another user's private agent never enters this set; it
      // simply doesn't match the row filter, and we surface NOT_FOUND below.
      const visibleAgents = await this.db
        .select({
          id: agents.id,
          userId: agents.userId,
          visibility: agents.visibility,
        })
        .from(agents)
        .where(
          and(
            inArray(agents.id, agentIds),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              {
                userId: agents.userId,
                workspaceId: agents.workspaceId,
                visibility: agents.visibility,
              },
            ),
          ),
        );

      const visibleById = new Map(visibleAgents.map((row) => [row.id, row]));
      for (const agentId of agentIds) {
        const row = visibleById.get(agentId);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
        }
        if (row.visibility === 'private' && !allowPrivateMembers) {
          // Caller owns this private agent (visibility predicate would have
          // hidden it otherwise) but the group can't hold private members.
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
        }
      }
    }

    const existingAgents = await this.getGroupAgents(groupId);
    const existingAgentIds = new Set(existingAgents.map((a) => a.agentId));

    const newAgentIds = agentIds.filter((id) => !existingAgentIds.has(id));
    const existingIds = agentIds.filter((id) => existingAgentIds.has(id));

    if (newAgentIds.length === 0) {
      return { added: [], existing: existingIds };
    }

    // Append new members after the current highest order so an incremental add
    // never collapses everyone to the default `order = 0` (which would make the
    // roster re-shuffle on every refetch). Supervisor rows sit at `order = -1`,
    // so a group holding only a supervisor yields maxOrder = -1 → the first
    // member gets order 0.
    const maxOrder = existingAgents.reduce((max, agent) => Math.max(max, agent.order ?? 0), -1);

    const newAgents: NewChatGroupAgent[] = newAgentIds.map((agentId, index) => ({
      agentId,
      chatGroupId: groupId,
      enabled: true,
      order: maxOrder + 1 + index,
      userId: this.userId,
      workspaceId: this.workspaceId ?? null,
    }));

    const added = await this.db.insert(chatGroupsAgents).values(newAgents).returning();

    return { added, existing: existingIds };
  }

  private agentsOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroupsAgents);

  async removeAgentFromGroup(groupId: string, agentId: string): Promise<void> {
    await this.db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.agentId, agentId),
          this.agentsOwnership(),
        ),
      );
  }

  /**
   * Batch remove multiple agents from a group.
   * More efficient than calling removeAgentFromGroup multiple times.
   */
  async removeAgentsFromGroup(groupId: string, agentIds: string[]): Promise<void> {
    if (agentIds.length === 0) return;

    await this.db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          inArray(chatGroupsAgents.agentId, agentIds),
          this.agentsOwnership(),
        ),
      );
  }

  async updateAgentInGroup(
    groupId: string,
    agentId: string,
    updates: Partial<Pick<NewChatGroupAgent, 'order' | 'role'>>,
  ): Promise<NewChatGroupAgent> {
    const [result] = await this.db
      .update(chatGroupsAgents)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.agentId, agentId),
          this.agentsOwnership(),
        ),
      )
      .returning();

    return result;
  }

  // ******* Delete Methods ******* //

  async delete(id: string): Promise<ChatGroupItem> {
    // Agents are automatically deleted due to CASCADE constraint
    const [result] = await this.db
      .delete(chatGroups)
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .returning();

    if (!result) {
      throw new Error('Chat group not found or access denied');
    }

    return result;
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(chatGroups).where(this.ownership());
  }

  // ******* Agent Query Methods ******* //

  async getGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]> {
    return this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId],
      where: and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        this.agentsOwnership(),
        this.memberAgentVisibleExists(),
      ),
    });
  }

  /**
   * Read-only roster of a group's **enabled** agents joined with their agent meta
   * (title/description) and membership role, ordered by member order.
   *
   * Used to inject the group member list — with the real `agt_*` IDs — into the
   * supervisor/member runtime context so the orchestration model dispatches
   * members by their actual IDs instead of hallucinating role names (which then
   * fail to resolve to an agent, surfacing as "Agent member(s) failed to start").
   *
   * Disabled members are excluded (matching `getEnabledGroupAgents`): advertising
   * them in `<group_participants>` would let the supervisor invoke a disabled
   * agent, since the group-management runtime accepts whatever id it dispatches.
   */
  async getGroupAgentsWithMeta(groupId: string): Promise<
    Array<{
      agentId: string;
      description: string | null;
      role: string | null;
      title: string | null;
    }>
  > {
    return this.db
      .select({
        agentId: chatGroupsAgents.agentId,
        description: agents.description,
        role: chatGroupsAgents.role,
        title: agents.title,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.enabled, true),
          this.agentsOwnership(),
          this.memberAgentVisibility(),
        ),
      )
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId);
  }

  /**
   * Count still-private member agents of a group — the publish guard uses
   * this to reject sharing a group whose members would leak on publish.
   */
  async countPrivateGroupAgents(groupId: string): Promise<number> {
    const rows = await this.db
      .select({ agentId: chatGroupsAgents.agentId })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(agents.visibility, 'private'),
          this.agentsOwnership(),
        ),
      );

    return rows.length;
  }

  async getEnabledGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]> {
    return this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId],
      where: and(
        eq(chatGroupsAgents.chatGroupId, groupId),
        eq(chatGroupsAgents.enabled, true),
        this.agentsOwnership(),
        this.memberAgentVisibleExists(),
      ),
    });
  }

  /**
   * Count workspace groups that would break if the given agent were demoted to
   * private: groups where it is the **supervisor** and the group is visible to
   * someone else (public, or owned by another member). A private supervisor is
   * unresolvable for every other viewer, which makes the whole group unusable —
   * so demotion is rejected at the source (mirrors
   * `countTasksBlockingAgentDemotion`). Regular members are deliberately NOT
   * counted: roster reads drop a non-visible member per viewer instead.
   * Deliberately workspace-wide and visibility-blind (NOT `ownership()`):
   * other members' private groups are invisible to the caller but their
   * supervisor would still break.
   */
  async countGroupsBlockingAgentDemotion(
    agentId: string,
    agentOwnerUserId: string,
  ): Promise<number> {
    if (!this.workspaceId) return 0;
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(chatGroupsAgents)
      .innerJoin(chatGroups, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
      .where(
        and(
          eq(chatGroups.workspaceId, this.workspaceId),
          eq(chatGroupsAgents.agentId, agentId),
          eq(chatGroupsAgents.role, 'supervisor'),
          or(eq(chatGroups.visibility, 'public'), ne(chatGroups.userId, agentOwnerUserId)),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async getGroupsWithAgents(agentIds?: string[]): Promise<ChatGroupItem[]> {
    if (!agentIds || agentIds.length === 0) {
      return this.query();
    }

    // Find groups containing any of the specified agents
    const groupIds = await this.db
      .selectDistinct({ chatGroupId: chatGroupsAgents.chatGroupId })
      .from(chatGroupsAgents)
      .where(
        and(
          this.agentsOwnership(),
          inArray(chatGroupsAgents.agentId, agentIds),
          this.memberAgentVisibleExists(),
        ),
      );

    if (groupIds.length === 0) return [];

    return this.db.query.chatGroups.findMany({
      orderBy: [desc(chatGroups.updatedAt)],
      where: and(
        inArray(
          chatGroups.id,
          groupIds.map((g) => g.chatGroupId),
        ),
        this.ownership(),
      ),
    });
  }
}
