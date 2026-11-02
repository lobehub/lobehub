import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { AgentGroupDetail, AgentGroupMember, AgentPluginEntry } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';

import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../../models/agentTransferJob';
import type { AgentItem, ChatGroupItem, NewChatGroup, NewChatGroupAgent } from '../../schemas';
import { agents, chatGroups, chatGroupsAgents, sessionGroups } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { GROUP_SUPERVISOR_ROLE, resolveGroupMembershipType } from '../../utils/groupMembership';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { GROUP_HAS_INACCESSIBLE_MEMBER } from './constants';
import {
  type CopyAgentGroupToWorkspaceOptions,
  copyGroupToWorkspace,
  duplicateGroup,
} from './copy';
import { deleteAllGroupsWithOwnedAgents, deleteGroupWithOwnedAgents } from './deletion';
import { AgentGroupScope } from './scope';
import { groupTransferHasForeignRows, transferGroupToWorkspace } from './transfer';
import { transferGroupOwnership } from './transferOwnership';

export { AGENT_GROUP_COPY_SOURCE_MOVED, GROUP_HAS_INACCESSIBLE_MEMBER } from './constants';

/** Slugs owned by builtin provisioning; a roster removal must never reach one. */
const RESERVED_BUILTIN_AGENT_SLUGS: string[] = Object.values(BUILTIN_AGENT_SLUGS);

export interface SupervisorAgentConfig {
  avatar?: string;
  backgroundColor?: string;
  chatConfig?: any;
  description?: string;
  model?: string;
  params?: any;
  plugins?: AgentPluginEntry[];
  provider?: string;
  systemRole?: string;
  tags?: string[];
  title?: string;
}

/**
 * Result of checking agents before removal
 */
export interface RemoveAgentsCheckResult {
  /**
   * `referenced` members: leaving the group only drops the link, the agent
   * itself lives on.
   */
  nonVirtualAgentIds: string[];
  /**
   * `owned` members: built for this group, so leaving it destroys them along
   * with their messages. Surfaced so the UI can confirm before that happens.
   */
  virtualAgents: Array<Pick<AgentItem, 'avatar' | 'description' | 'id' | 'title'>>;
}

/**
 * Result of removing agents from group
 */
export interface RemoveAgentsFromGroupResult {
  /** IDs of virtual agents that were permanently deleted */
  deletedVirtualAgentIds: string[];
  /** Number of agents removed from group */
  removedFromGroup: number;
}

export interface CreateGroupWithSupervisorResult {
  agents: NewChatGroupAgent[];
  group: ChatGroupItem;
  supervisorAgentId: string;
}

/**
 * Agent Group Repository - provides agent group detail data
 */
export class AgentGroupRepository {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;
  /** Caller scope shared with the copy / transfer modules (ownership predicates). */
  private scope: AgentGroupScope;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
    this.scope = new AgentGroupScope(db, userId, workspaceId);
  }

  /**
   * Find a chat group by ID with its associated agents.
   * If no supervisor exists, a virtual supervisor agent is automatically created.
   * @param groupId - The chat group ID
   * @returns AgentGroupDetail with group info, agents array, and supervisor agent ID
   */
  async findByIdWithAgents(groupId: string): Promise<AgentGroupDetail | null> {
    // 1. Find the group
    const group = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, groupId), this.scope.groupOwnership()),
    });

    if (!group) return null;

    // 2. Find all agents associated with this group (including role info). The
    // roster is fetched raw (no visibility filter) with a per-row `visible`
    // flag: supervisor existence must be judged on the raw rows — otherwise a
    // viewer who can't see the supervisor would auto-create a duplicate one
    // below — while a member agent switched back to private must not leak its
    // config to other members, so only visible rows are returned.
    const groupAgentsWithDetails = await this.db
      .select({
        agent: agents,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
        visible: sql<boolean>`(${this.scope.agentOwnership()})`,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(eq(chatGroupsAgents.chatGroupId, groupId))
      // `createdAt` then `agentId` are deterministic tiebreaks so rows sharing
      // an `order` (e.g. legacy members left at the default 0) keep a stable
      // order instead of shuffling on every refetch. `agentId` is the final,
      // guaranteed-unique key (part of the PK) because a single multi-row insert
      // stamps every row with the same `createdAt`, which alone can still tie.
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId);

    // 3. Extract agent items with isSupervisor flag and find supervisor
    const agentItems: AgentGroupMember[] = [];
    let supervisorAgentId: string | undefined;

    for (const row of groupAgentsWithDetails) {
      const isSupervisor = row.role === 'supervisor';
      if (isSupervisor) {
        supervisorAgentId = row.agent.id;
      }
      // The supervisor is a group-owned synthetic agent: anyone who can read
      // the group needs it to run group chat, and `publishToWorkspace` keeps
      // its visibility in sync with the group. Skipping an out-of-sync legacy
      // row would strand `supervisorAgentId` without a matching agent entry.
      if (!row.visible && !isSupervisor) continue;
      agentItems.push(
        cleanObject({
          ...row.agent,
          isSupervisor,
          // Inject builtin agent slug for supervisor
          slug: isSupervisor ? BUILTIN_AGENT_SLUGS.groupSupervisor : row.agent.slug,
        }) as AgentGroupMember,
      );
    }

    // 4. If no supervisor exists, create a virtual supervisor agent
    if (!supervisorAgentId) {
      // Create supervisor agent (virtual agent)
      const [supervisorAgent] = await this.db
        .insert(agents)
        .values({
          model: undefined,
          provider: undefined,
          title: 'Supervisor',
          userId: this.userId,
          virtual: true,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();

      // Add supervisor agent to group with role 'supervisor'
      await this.db.insert(chatGroupsAgents).values({
        agentId: supervisorAgent.id,
        chatGroupId: group.id,
        order: -1, // Supervisor always first (negative order)
        role: GROUP_SUPERVISOR_ROLE,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      });

      supervisorAgentId = supervisorAgent.id;

      // Insert at the beginning of agents array
      agentItems.unshift(
        cleanObject({
          ...supervisorAgent,
          isSupervisor: true,
          // Inject builtin agent slug for supervisor
          slug: BUILTIN_AGENT_SLUGS.groupSupervisor,
        }) as AgentGroupMember,
      );
    }

    return {
      ...group,
      agents: agentItems,
      supervisorAgentId,
    } as AgentGroupDetail;
  }

  /**
   * Create a chat group with a supervisor agent and optional member agents.
   * The supervisor agent is automatically created as a virtual agent with role 'supervisor'.
   *
   * @param groupParams - Parameters for creating the chat group
   * @param agentMembers - Array of existing agent IDs to add as members (optional)
   * @param supervisorConfig - Optional configuration for the supervisor agent
   * @returns Created group, agents, and supervisor agent ID
   */
  /**
   * Resolve a folder the caller may put a group in, returning its visibility.
   * Mirrors `AgentModel.getAssignableSessionGroupVisibility` — the foreign key
   * only proves the folder exists, which is the wrong question once the column
   * is read by every member's sidebar.
   */
  async getAssignableFolderVisibility(folderId: string): Promise<'private' | 'public'> {
    const [folder] = await this.db
      .select({ visibility: sessionGroups.visibility })
      .from(sessionGroups)
      .where(
        and(
          eq(sessionGroups.id, folderId),
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

    if (!folder) throw new Error(`Session group ${folderId} not found in current scope`);

    return folder.visibility as 'private' | 'public';
  }

  async createGroupWithSupervisor(
    groupParams: Omit<NewChatGroup, 'userId'>,
    agentMembers: string[] = [],
    supervisorConfig?: SupervisorAgentConfig,
  ): Promise<CreateGroupWithSupervisorResult> {
    // Creating inside a Category has to land in that Category. The sidebar
    // resolves a public group's folder only against public folders (and a
    // private group's only against private ones), so a default-public group
    // created in a private Category renders in Ungrouped — for its creator as
    // well. The folder therefore decides the new group's visibility, and an
    // explicit value that contradicts it is refused rather than overridden.
    // Same rule and same reasoning as agent creation.
    const folderVisibility = groupParams.groupId
      ? await this.getAssignableFolderVisibility(groupParams.groupId)
      : undefined;

    if (folderVisibility && groupParams.visibility && groupParams.visibility !== folderVisibility)
      throw new Error(
        `A ${groupParams.visibility} chat group cannot be created in a ${folderVisibility} folder`,
      );

    // Mirror the group's visibility onto the synthetic supervisor agent so
    // workspace members don't see a stray supervisor when the parent group is
    // private. Defaults to 'public' to match the column default.
    const groupVisibility = groupParams.visibility ?? folderVisibility ?? 'public';

    // A failed group insert (e.g. a duplicate clientId on retry) must not
    // leave the synthetic supervisor agent behind.
    return this.db.transaction(async (trx) => {
      const memberIds = [...new Set(agentMembers)];
      if (memberIds.length > 0) {
        const visibleMembers = await trx
          .select({ id: agents.id })
          .from(agents)
          .where(and(inArray(agents.id, memberIds), this.scope.agentOwnership()));

        if (visibleMembers.length !== memberIds.length) {
          throw new Error(GROUP_HAS_INACCESSIBLE_MEMBER);
        }
      }

      // 1. Create supervisor agent (virtual agent)
      const [supervisorAgent] = await trx
        .insert(agents)
        .values({
          avatar: supervisorConfig?.avatar,
          backgroundColor: supervisorConfig?.backgroundColor,
          chatConfig: supervisorConfig?.chatConfig,
          description: supervisorConfig?.description,
          model: supervisorConfig?.model,
          params: supervisorConfig?.params,
          // The `plugins` column is still typed `string[]` at the schema layer
          // (widening deferred to the tri-state rollout's final phase) but
          // legitimately holds mixed AgentPluginEntry[] at runtime — JSONB has
          // no schema enforcement.
          plugins: supervisorConfig?.plugins as unknown as string[] | undefined,
          provider: supervisorConfig?.provider,
          systemRole: supervisorConfig?.systemRole,
          tags: supervisorConfig?.tags,
          title: supervisorConfig?.title ?? 'Supervisor',
          userId: this.userId,
          virtual: true,
          visibility: groupVisibility,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();

      // 2. Create the group
      const [group] = await trx
        .insert(chatGroups)
        .values({
          ...groupParams,
          userId: this.userId,
          visibility: groupVisibility,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();

      // 3. Add supervisor agent to group with role 'supervisor'
      const supervisorGroupAgent: NewChatGroupAgent = {
        agentId: supervisorAgent.id,
        chatGroupId: group.id,
        order: -1, // Supervisor always first (negative order)
        role: GROUP_SUPERVISOR_ROLE,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      };

      // 4. Add member agents to group with role 'participant'
      const memberGroupAgents: NewChatGroupAgent[] = agentMembers.map((agentId, index) => ({
        agentId,
        chatGroupId: group.id,
        order: index,
        role: 'participant',
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      }));

      // 5. Insert all group-agent relationships
      const allGroupAgents = [supervisorGroupAgent, ...memberGroupAgents];
      const insertedAgents = await trx.insert(chatGroupsAgents).values(allGroupAgents).returning();

      return {
        agents: insertedAgents,
        group,
        supervisorAgentId: supervisorAgent.id,
      };
    });
  }

  /**
   * Split a removal request into members that merely get unlinked and members
   * that die with the link, so the frontend can confirm the destructive half.
   *
   * Judged through the shared `resolveGroupMembershipType`, joined to the
   * membership row in THIS group so the supervisor rule applies.
   *
   * @param groupId - The chat group ID
   * @param agentIds - Array of agent IDs to check
   * @returns Object containing owned (deleted) and referenced (unlinked) lists
   */
  async checkAgentsBeforeRemoval(
    groupId: string,
    agentIds: string[],
  ): Promise<RemoveAgentsCheckResult> {
    if (agentIds.length === 0) {
      return { nonVirtualAgentIds: [], virtualAgents: [] };
    }

    // Get agent details for the specified IDs, joined to their membership row
    // in THIS group.
    const agentDetails = await this.db
      .select({
        avatar: agents.avatar,
        description: agents.description,
        id: agents.id,
        name: agents.name,
        role: chatGroupsAgents.role,
        slug: agents.slug,
        title: agents.title,
        virtual: agents.virtual,
      })
      .from(agents)
      .innerJoin(
        chatGroupsAgents,
        and(eq(chatGroupsAgents.agentId, agents.id), eq(chatGroupsAgents.chatGroupId, groupId)),
      )
      .where(and(this.scope.agentOwnership(), inArray(agents.id, agentIds)));

    const virtualAgents: RemoveAgentsCheckResult['virtualAgents'] = [];
    const nonVirtualAgentIds: string[] = [];

    for (const agent of agentDetails) {
      if (resolveGroupMembershipType(agent) === 'owned') {
        const meta = normalizeInboxAgentMeta(
          { avatar: agent.avatar, title: agent.title },
          { slug: agent.slug },
        );

        virtualAgents.push({
          avatar: meta.avatar,
          description: agent.description,
          id: agent.id,
          title: meta.title,
        });
      } else {
        nonVirtualAgentIds.push(agent.id);
      }
    }

    return { nonVirtualAgentIds, virtualAgents };
  }

  /**
   * Remove agents from a group. Virtual agents will be permanently deleted.
   *
   * @param groupId - The chat group ID
   * @param agentIds - Array of agent IDs to remove
   * @param deleteVirtualAgents - Whether to delete virtual agents (default: true)
   * @returns Result containing counts and deleted virtual agent IDs
   */
  async removeAgentsFromGroup(
    groupId: string,
    agentIds: string[],
    deleteVirtualAgents: boolean = true,
  ): Promise<RemoveAgentsFromGroupResult> {
    if (agentIds.length === 0) {
      return { deletedVirtualAgentIds: [], removedFromGroup: 0 };
    }

    // 1. Check which agents are virtual
    const { virtualAgents } = await this.checkAgentsBeforeRemoval(groupId, agentIds);
    const virtualAgentIds = virtualAgents.map((a) => a.id);

    return this.db.transaction(async (trx) => {
      // Lock-then-guard, same order as `transferToWorkspace`: take the member
      // rows before consulting the job tables so a concurrent enqueue cannot
      // slip its job row in after the guard reads and before the delete lands.
      await trx
        .select({ id: agents.id })
        .from(agents)
        .where(and(inArray(agents.id, agentIds), this.scope.agentOwnership()))
        .orderBy(asc(agents.id))
        .for('update');

      // An unfinished backfill maps message rows onto these agent ids. Both
      // junctions record the TARGET side, so this catches removing an agent a
      // pending copy is still writing into — its drain would insert
      // `messages.agent_id` against a row this delete just cascaded away, and
      // the FK violation would retry forever, stranding the conversations as
      // pending. The group guard additionally covers an empty roster, which
      // registers no agent rows at all.
      if (
        (await AgentTransferJobModel.hasPendingJobForAgents(trx, agentIds)) ||
        (await AgentTransferJobModel.hasPendingJobForGroups(trx, [groupId]))
      ) {
        throw new Error(AGENT_TRANSFER_IN_PROGRESS);
      }
      // Copy jobs register only their TARGET side above; guard the source too,
      // or deleting a virtual member would cascade away the very messages a
      // pending copy is still reading from.
      if (
        (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, agentIds)) ||
        (await AgentCopyJobModel.hasPendingCopyJobForSourceGroups(trx, [groupId]))
      ) {
        throw new Error(AGENT_COPY_IN_PROGRESS);
      }

      // 2. Remove all agents from the group (batch delete from junction table).
      // Scope by the caller's ownership so a client-supplied groupId can only touch
      // the caller's own junction rows — never another user's group membership (IDOR).
      const removed = await trx
        .delete(chatGroupsAgents)
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            inArray(chatGroupsAgents.agentId, agentIds),
            this.scope.groupAgentOwnership(),
          ),
        )
        .returning({ agentId: chatGroupsAgents.agentId });

      // 3. Delete virtual agents if requested
      // Note: Virtual agents are standalone (no associated sessions), so we can delete them directly
      // The messages sent by these agents in the group chat will remain (orphaned agentId reference)
      if (deleteVirtualAgents && virtualAgentIds.length > 0) {
        await trx.delete(agents).where(
          and(
            this.scope.agentOwnership(),
            inArray(agents.id, virtualAgentIds),
            // Same backstop as `deleteGroup`: builtins (Inbox, the
            // agent builders) are `virtual` too, so a malformed roster row
            // would otherwise classify one as this group's own and take it
            // down on removal. `addAgentsToGroup` refuses them at the door;
            // this is the belt to that brace, on a delete whose blast radius
            // is somebody's Inbox.
            //
            // A NULL slug predates slug generation and is not a builtin;
            // `NOT IN` alone would evaluate to NULL and skip those rows.
            or(isNull(agents.slug), notInArray(agents.slug, RESERVED_BUILTIN_AGENT_SLUGS)),
          ),
        );
      }

      return {
        deletedVirtualAgentIds: deleteVirtualAgents ? virtualAgentIds : [],
        removedFromGroup: removed.length,
      };
    });
  }

  /**
   * Duplicate a chat group with all its members within the current scope.
   * See `duplicateGroup` for the member handling.
   */
  async duplicate(
    groupId: string,
    newTitle?: string,
  ): Promise<{ groupId: string; supervisorAgentId: string } | null> {
    return duplicateGroup(this.scope, groupId, newTitle);
  }

  /**
   * Members these groups merely reference — the ones the roster shows as
   * `External`.
   *
   * A group transfer cannot take them along (they are their owners' agents,
   * with sessions and knowledge bases a group transfer does not touch), so it
   * leaves them behind and clones them instead. Callers ask this first so the
   * user hears about that before it happens rather than after.
   *
   * Reports only members the caller could already see on the roster. A member
   * hidden from them is under-reported rather than exposed — it is invisible
   * to this caller everywhere else too, so naming it here would make a
   * confirmation dialog the one place a private agent leaks.
   */
  async listReferencedMembers(groupIds: string[]): Promise<
    {
      agentId: string;
      avatar: string | null;
      backgroundColor: string | null;
      groupId: string;
      title: string | null;
    }[]
  > {
    if (groupIds.length === 0) return [];

    const rows = await this.db
      .select({
        agentId: chatGroupsAgents.agentId,
        // Avatar + background travel with the name so the confirmation can show
        // each member the way the roster does; a bare name in a warning box is
        // the one thing on that step with no visual anchor.
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        groupId: chatGroupsAgents.chatGroupId,
        role: chatGroupsAgents.role,
        // Needed by `resolveGroupMembershipType`: without it a builtin row on
        // a roster reads as merely `virtual` — i.e. owned — and drops out of
        // this warning, while the transfer (which does pass `slug`) treats it
        // as referenced and clones it. The warning would omit the one row the
        // move is about to act on.
        slug: agents.slug,
        title: agents.title,
        virtual: agents.virtual,
      })
      .from(chatGroupsAgents)
      .innerJoin(chatGroups, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(
        and(
          inArray(chatGroupsAgents.chatGroupId, groupIds),
          // Scoped on the GROUP: seeing a roster is a group-level read, and a
          // caller who cannot see the group learns nothing about its members.
          this.scope.groupOwnership(),
          // AND on the member agent, exactly as the roster reads do
          // (`memberAgentVisibility`). Seeing the group is not enough: a member
          // whose owner has since flipped it back to `private` is hidden from
          // the roster, and this warning must not be the one surface that
          // hands out its title and avatar.
          this.scope.agentOwnership(),
        ),
      )
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.agentId);

    return rows
      .filter((row) => resolveGroupMembershipType(row) === 'referenced')
      .map((row) => ({
        agentId: row.agentId,
        avatar: row.avatar,
        backgroundColor: row.backgroundColor,
        groupId: row.groupId,
        title: row.title,
      }));
  }

  /**
   * Whether the group's transfer cascade contains rows created by someone
   * else. See `groupTransferHasForeignRows`.
   */
  async transferHasForeignRows(groupId: string): Promise<boolean> {
    return groupTransferHasForeignRows(this.scope, groupId);
  }

  async transferToWorkspace(
    groupId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
    options: { rejectForeignTopicCommentAuthors?: boolean } = {},
  ): Promise<{ groupId: string; transferJobId: string | null } | null> {
    return transferGroupToWorkspace(
      this.scope,
      groupId,
      targetWorkspaceId,
      targetUserId,
      targetVisibility,
      options,
    );
  }

  /**
   * Fork a group into another scope. See `copyGroupToWorkspace`; the caller
   * must kick the job driver after commit when a `copyJobId` is returned.
   */
  async copyToWorkspace(
    groupId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    optionsOrNewTitle?: CopyAgentGroupToWorkspaceOptions | string,
  ): Promise<{ copyJobId: string | null; groupId: string; supervisorAgentId: string } | null> {
    return copyGroupToWorkspace(
      this.scope,
      groupId,
      targetWorkspaceId,
      targetUserId,
      optionsOrNewTitle,
    );
  }

  /**
   * Delete a group together with the agents that only existed to serve it,
   * in one transaction. See {@link deleteGroupWithOwnedAgents}.
   */
  async deleteGroup(
    groupId: string,
  ): Promise<{ deletedOwnedAgentIds: string[]; group: ChatGroupItem }> {
    return deleteGroupWithOwnedAgents(this.scope, groupId);
  }

  /** Delete every group in scope together with the agents they own. */
  async deleteAllGroups(): Promise<void> {
    return deleteAllGroupsWithOwnedAgents(this.scope);
  }

  /**
   * Same-workspace ownership handover, run inside the caller's transaction.
   * See {@link transferGroupOwnership}.
   */
  async transferOwnership(
    trx: Transaction,
    params: Parameters<typeof transferGroupOwnership>[2],
  ): Promise<void> {
    return transferGroupOwnership(this.scope, trx, params);
  }
}
