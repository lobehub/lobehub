import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type {
  ChatGroupAgentItem,
  ChatGroupItem,
  NewChatGroup,
  NewChatGroupAgent,
} from '../../schemas';
import { agents, chatGroups, chatGroupsAgents, sessionGroups } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import type { GroupMemberRole } from '../../utils/groupMembership';
import { GROUP_SUPERVISOR_ROLE } from '../../utils/groupMembership';
import { normalizeInboxAgentAvatar } from '../../utils/inboxAgent';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../../utils/workspace';
import * as deletion from './deletion';
import * as membership from './membership';
import { type ChatGroupContext, groupAgentsOwnership, groupOwnership } from './scope';

export { CHAT_GROUP_OWNERSHIP_STALE, CHAT_GROUP_TRANSFER_HIDDEN_MEMBER } from './constants';

export class ChatGroupModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  private ctx: ChatGroupContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.ctx = { db, model: this, userId, workspaceId };
  }

  private ownership = () => groupOwnership(this.ctx);

  private agentsOwnership = () => groupAgentsOwnership(this.ctx);

  /**
   * Visibility predicate on the member's `agents` row itself. Group membership
   * (the junction row) does not grant access to the agent: when a member agent
   * is switched back to private by its owner, every roster read must drop it
   * for other members — otherwise the join would keep leaking the agent's
   * config/meta through group surfaces.
   */
  private memberAgentVisibility = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        isDeleted: agents.isDeleted,
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
      return sql`EXISTS (SELECT 1 FROM "agents" "ma" WHERE "ma"."id" = ${chatGroupsAgents.agentId} AND "ma"."user_id" = ${this.userId} AND "ma"."workspace_id" IS NULL AND "ma"."is_deleted" IS NOT TRUE)`;
    }
    return sql`EXISTS (SELECT 1 FROM "agents" "ma" WHERE "ma"."id" = ${chatGroupsAgents.agentId} AND "ma"."workspace_id" = ${this.workspaceId} AND ("ma"."visibility" IS NULL OR "ma"."visibility" = 'public' OR ("ma"."visibility" = 'private' AND "ma"."user_id" = ${this.userId})) AND "ma"."is_deleted" IS NOT TRUE)`;
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

  /**
   * The supervisor agent a group's conversation answers to, or `null`.
   *
   * Deliberately scoped by workspace rather than by {@link ownership}: callers
   * use this to look up what the group's author decided (its supervisor's
   * permission policies), which must not depend on whether *this* caller can
   * see the group row. A visibility-scoped miss would return `null` and fail
   * open.
   */
  getSupervisorAgentId = async (groupId: string): Promise<string | null> => {
    const [row] = await this.db
      .select({ agentId: chatGroupsAgents.agentId })
      .from(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.role, GROUP_SUPERVISOR_ROLE),
          this.workspaceId
            ? eq(chatGroupsAgents.workspaceId, this.workspaceId)
            : and(eq(chatGroupsAgents.userId, this.userId), isNull(chatGroupsAgents.workspaceId)),
        ),
      )
      .limit(1);

    return row?.agentId ?? null;
  };

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

  /**
   * A move target must be a folder the caller can see, and a workspace-public
   * group may only sit in a public folder. `chat_groups.groupId` is read by
   * every member's sidebar now, and the foreign key only proves the folder
   * exists — another workspace's folder, or another member's private one,
   * satisfies it and then renders as Ungrouped for everyone who cannot see it.
   * Mirrors `AgentModel.assertSessionGroupAssignable`.
   */
  private async assertFolderAssignable(id: string, groupId: string) {
    const [folder] = await this.db
      .select({ visibility: sessionGroups.visibility })
      .from(sessionGroups)
      .where(
        and(
          eq(sessionGroups.id, groupId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              isDeleted: sessionGroups.isDeleted,
              userId: sessionGroups.userId,
              visibility: sessionGroups.visibility,
              workspaceId: sessionGroups.workspaceId,
            },
          ),
        ),
      )
      .limit(1);

    if (!folder) throw new Error(`Session group ${groupId} not found in current scope`);

    if (!this.workspaceId) return;

    const [group] = await this.db
      .select({ visibility: chatGroups.visibility })
      .from(chatGroups)
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .limit(1);

    // Same exact-match rule as agents: the render path resolves a private
    // item's folder only against private folders and a public item's only
    // against public ones, so either mismatch lands it in Ungrouped.
    if (group && group.visibility !== folder.visibility)
      throw new Error(
        `A ${group.visibility} chat group cannot be moved into a ${folder.visibility} folder`,
      );
  }

  async update(id: string, value: Partial<ChatGroupItem>): Promise<ChatGroupItem> {
    if (value.groupId) await this.assertFolderAssignable(id, value.groupId);

    // Scope columns never travel through the generic update. The router hands
    // this a partial insert schema, so without stripping them a member could
    // re-scope another member's group now that the ownership predicate spans
    // every visible workspace row. Ignored rather than rejected so a client
    // that sends an extra field still gets its real edit applied. Publishing
    // has its own path and writes `visibility` directly.
    const { userId: _userId, visibility: _visibility, workspaceId: _workspaceId, ...safe } = value;

    const [result] = await this.db
      .update(chatGroups)
      .set(safe)
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
    // Rehome exactly as `setVisibility` does. A folder cannot mix
    // visibilities, so publishing out of a private Category has to release the
    // folder too — left in place, the group would be public while its folder
    // is not, and the sidebar would show it in Ungrouped rather than where the
    // user published it from.
    const [current] = await this.db
      .select({ folderVisibility: sessionGroups.visibility })
      .from(chatGroups)
      .leftJoin(sessionGroups, eq(chatGroups.groupId, sessionGroups.id))
      .where(and(eq(chatGroups.id, id), this.ownership()))
      .limit(1);
    const clearFolder = current?.folderVisibility != null && current.folderVisibility !== 'public';

    const [result] = await this.db
      .update(chatGroups)
      .set({
        updatedAt: new Date(),
        visibility: 'public',
        ...(clearFolder ? { groupId: null } : {}),
      })
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
    options?: { order?: number; role?: GroupMemberRole },
  ): Promise<NewChatGroupAgent> {
    return membership.addAgentToGroup(this.ctx, groupId, agentId, options);
  }

  async addAgentsToGroup(
    groupId: string,
    agentIds: string[],
  ): Promise<{ added: NewChatGroupAgent[]; existing: string[] }> {
    return membership.addAgentsToGroup(this.ctx, groupId, agentIds);
  }

  async removeAgentFromGroup(groupId: string, agentId: string): Promise<void> {
    return membership.removeAgentFromGroup(this.ctx, groupId, agentId);
  }

  async removeAgentsFromGroup(groupId: string, agentIds: string[]): Promise<void> {
    return membership.removeAgentsFromGroup(this.ctx, groupId, agentIds);
  }

  async updateAgentInGroup(
    groupId: string,
    agentId: string,
    updates: Partial<Pick<NewChatGroupAgent, 'enabled' | 'order'>> & { role?: GroupMemberRole },
  ): Promise<NewChatGroupAgent> {
    return membership.updateAgentInGroup(this.ctx, groupId, agentId, updates);
  }

  // ******* Delete Methods ******* //

  /**
   * Delete one group row (its junction rows cascade). Group aggregate only —
   * deleting a group together with the agents it owns goes through
   * `AgentGroupRepository.deleteGroup`.
   */
  async delete(id: string): Promise<ChatGroupItem> {
    return deletion.deleteGroup(this.ctx, id);
  }

  /** Delete every group in scope (group aggregate only; see {@link delete}). */
  async deleteAll(): Promise<void> {
    return deletion.deleteAllGroups(this.ctx);
  }

  /** See {@link deletion.findOwnedMemberAgentIds}. */
  async findOwnedMemberAgentIds(groupIds: string[]): Promise<string[]> {
    return deletion.findOwnedMemberAgentIds(this.ctx, groupIds);
  }

  /** Ids of every group in the caller's scope. */
  async findIdsInScope(): Promise<string[]> {
    return deletion.findGroupIdsInScope(this.ctx);
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

  async getGroupAgentsByGroupIds(groupIds: string[]): Promise<ChatGroupAgentItem[]> {
    if (groupIds.length === 0) return [];

    return this.db.query.chatGroupsAgents.findMany({
      orderBy: [chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId],
      where: and(
        inArray(chatGroupsAgents.chatGroupId, groupIds),
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
      name: string | null;
      role: string | null;
      title: string | null;
    }>
  > {
    return this.db
      .select({
        agentId: chatGroupsAgents.agentId,
        description: agents.description,
        name: agents.name,
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
          // The synthetic supervisor mirrors the group's own visibility, so a
          // private group always owns one private agent. Counting it makes the
          // publish guard unsatisfiable — every private group would look like
          // it still holds private members and could never be shared. Only
          // real members can block a publish.
          ne(chatGroupsAgents.role, 'supervisor'),
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
