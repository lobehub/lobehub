import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { AgentGroupDetail, AgentGroupMember } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, eq, inArray } from 'drizzle-orm';

import type { AgentItem, ChatGroupItem, NewChatGroup, NewChatGroupAgent } from '../../schemas';
import { agents, chatGroups, chatGroupsAgents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

export interface SupervisorAgentConfig {
  avatar?: string;
  backgroundColor?: string;
  chatConfig?: any;
  description?: string;
  model?: string;
  params?: any;
  plugins?: string[];
  provider?: string;
  systemRole?: string;
  tags?: string[];
  title?: string;
}

/**
 * Result of checking agents before removal
 */
export interface RemoveAgentsCheckResult {
  /** Agent IDs that are not virtual and can be safely removed from group */
  nonVirtualAgentIds: string[];
  /** Virtual agents that will be permanently deleted along with their messages */
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

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
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
      where: and(eq(chatGroups.id, groupId), eq(chatGroups.userId, this.userId)),
    });

    if (!group) return null;

    // 2. Find all agents associated with this group (including role info)
    const groupAgentsWithDetails = await this.db
      .select({
        agent: agents,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(eq(chatGroupsAgents.chatGroupId, groupId))
      .orderBy(chatGroupsAgents.order);

    // 3. Extract agent items with isSupervisor flag and find supervisor
    const agentItems: AgentGroupMember[] = [];
    let supervisorAgentId: string | undefined;

    for (const row of groupAgentsWithDetails) {
      const isSupervisor = row.role === 'supervisor';
      agentItems.push(
        cleanObject({
          ...row.agent,
          isSupervisor,
          // Inject builtin agent slug for supervisor
          slug: isSupervisor ? BUILTIN_AGENT_SLUGS.groupSupervisor : row.agent.slug,
        }) as AgentGroupMember,
      );
      if (isSupervisor) {
        supervisorAgentId = row.agent.id;
      }
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
        })
        .returning();

      // Add supervisor agent to group with role 'supervisor'
      await this.db.insert(chatGroupsAgents).values({
        agentId: supervisorAgent.id,
        chatGroupId: group.id,
        order: -1, // Supervisor always first (negative order)
        role: 'supervisor',
        userId: this.userId,
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
  async createGroupWithSupervisor(
    groupParams: Omit<NewChatGroup, 'userId'>,
    agentMembers: string[] = [],
    supervisorConfig?: SupervisorAgentConfig,
  ): Promise<CreateGroupWithSupervisorResult> {
    // 1. Create supervisor agent (virtual agent)
    const [supervisorAgent] = await this.db
      .insert(agents)
      .values({
        avatar: supervisorConfig?.avatar,
        backgroundColor: supervisorConfig?.backgroundColor,
        chatConfig: supervisorConfig?.chatConfig,
        description: supervisorConfig?.description,
        model: supervisorConfig?.model,
        params: supervisorConfig?.params,
        plugins: supervisorConfig?.plugins,
        provider: supervisorConfig?.provider,
        systemRole: supervisorConfig?.systemRole,
        tags: supervisorConfig?.tags,
        title: supervisorConfig?.title ?? 'Supervisor',
        userId: this.userId,
        virtual: true,
      })
      .returning();

    // 2. Create the group
    const [group] = await this.db
      .insert(chatGroups)
      .values({ ...groupParams, userId: this.userId })
      .returning();

    // 3. Add supervisor agent to group with role 'supervisor'
    const supervisorGroupAgent: NewChatGroupAgent = {
      agentId: supervisorAgent.id,
      chatGroupId: group.id,
      order: -1, // Supervisor always first (negative order)
      role: 'supervisor',
      userId: this.userId,
    };

    // 4. Add member agents to group with role 'participant'
    const memberGroupAgents: NewChatGroupAgent[] = agentMembers.map((agentId, index) => ({
      agentId,
      chatGroupId: group.id,
      order: index,
      role: 'participant',
      userId: this.userId,
    }));

    // 5. Insert all group-agent relationships
    const allGroupAgents = [supervisorGroupAgent, ...memberGroupAgents];
    const insertedAgents = await this.db
      .insert(chatGroupsAgents)
      .values(allGroupAgents)
      .returning();

    return {
      agents: insertedAgents,
      group,
      supervisorAgentId: supervisorAgent.id,
    };
  }

  /**
   * Check which agents are virtual before removing them from a group.
   * This allows the frontend to show a confirmation dialog for virtual agents.
   *
   * @param groupId - The chat group ID
   * @param agentIds - Array of agent IDs to check
   * @returns Object containing virtual and non-virtual agent lists
   */
  async checkAgentsBeforeRemoval(
    groupId: string,
    agentIds: string[],
  ): Promise<RemoveAgentsCheckResult> {
    if (agentIds.length === 0) {
      return { nonVirtualAgentIds: [], virtualAgents: [] };
    }

    // Get agent details for the specified IDs
    const agentDetails = await this.db
      .select({
        avatar: agents.avatar,
        description: agents.description,
        id: agents.id,
        title: agents.title,
        virtual: agents.virtual,
      })
      .from(agents)
      .where(and(eq(agents.userId, this.userId), inArray(agents.id, agentIds)));

    const virtualAgents: RemoveAgentsCheckResult['virtualAgents'] = [];
    const nonVirtualAgentIds: string[] = [];

    for (const agent of agentDetails) {
      if (agent.virtual) {
        virtualAgents.push({
          avatar: agent.avatar,
          description: agent.description,
          id: agent.id,
          title: agent.title,
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

    // 2. Remove all agents from the group (batch delete from junction table)
    await this.db
      .delete(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.chatGroupId, groupId), inArray(chatGroupsAgents.agentId, agentIds)),
      );

    // 3. Delete virtual agents if requested
    // Note: Virtual agents are standalone (no associated sessions), so we can delete them directly
    // The messages sent by these agents in the group chat will remain (orphaned agentId reference)
    if (deleteVirtualAgents && virtualAgentIds.length > 0) {
      await this.db
        .delete(agents)
        .where(and(eq(agents.userId, this.userId), inArray(agents.id, virtualAgentIds)));
    }

    return {
      deletedVirtualAgentIds: deleteVirtualAgents ? virtualAgentIds : [],
      removedFromGroup: agentIds.length,
    };
  }

  /**
   * Duplicate a chat group with all its members.
   * - Creates a new group with the same config
   * - Creates a new supervisor agent
   * - For virtual member agents: creates new copies
   * - For non-virtual member agents: adds relationship only (references same agents)
   *
   * @param groupId - The chat group ID to duplicate
   * @param newTitle - Optional new title for the duplicated group
   * @returns The new group ID and supervisor agent ID, or null if source not found
   */
  async duplicate(
    groupId: string,
    newTitle?: string,
  ): Promise<{ groupId: string; supervisorAgentId: string } | null> {
    // 1. Get the source group
    const sourceGroup = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, groupId), eq(chatGroups.userId, this.userId)),
    });

    if (!sourceGroup) return null;

    // 2. Get all agents in the group with their details
    const groupAgentsWithDetails = await this.db
      .select({
        agent: agents,
        enabled: chatGroupsAgents.enabled,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
      })
      .from(chatGroupsAgents)
      .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
      .where(eq(chatGroupsAgents.chatGroupId, groupId))
      .orderBy(chatGroupsAgents.order);

    // 3. Separate supervisor, virtual members, and non-virtual members
    let sourceSupervisor: (typeof groupAgentsWithDetails)[number] | undefined;
    const virtualMembers: (typeof groupAgentsWithDetails)[number][] = [];
    const nonVirtualMembers: (typeof groupAgentsWithDetails)[number][] = [];

    for (const row of groupAgentsWithDetails) {
      if (row.role === 'supervisor') {
        sourceSupervisor = row;
      } else if (row.agent.virtual) {
        virtualMembers.push(row);
      } else {
        nonVirtualMembers.push(row);
      }
    }

    // Use transaction to ensure atomicity
    return this.db.transaction(async (trx) => {
      // 4. Create the new group
      const [newGroup] = await trx
        .insert(chatGroups)
        .values({
          avatar: sourceGroup.avatar,
          backgroundColor: sourceGroup.backgroundColor,
          config: sourceGroup.config,
          content: sourceGroup.content,
          description: sourceGroup.description,
          editorData: sourceGroup.editorData,
          pinned: sourceGroup.pinned,
          title: newTitle || (sourceGroup.title ? `${sourceGroup.title} (Copy)` : 'Copy'),
          userId: this.userId,
        })
        .returning();

      // 5. Create new supervisor agent
      const supervisorAgent = sourceSupervisor?.agent;
      const [newSupervisor] = await trx
        .insert(agents)
        .values({
          avatar: supervisorAgent?.avatar,
          backgroundColor: supervisorAgent?.backgroundColor,
          description: supervisorAgent?.description,
          model: supervisorAgent?.model,
          params: supervisorAgent?.params,
          provider: supervisorAgent?.provider,
          systemRole: supervisorAgent?.systemRole,
          tags: supervisorAgent?.tags,
          title: supervisorAgent?.title || 'Supervisor',
          userId: this.userId,
          virtual: true,
        })
        .returning();

      // 6. Create copies of virtual member agents using include mode
      const newVirtualAgentMap = new Map<string, string>(); // oldId -> newId
      if (virtualMembers.length > 0) {
        const virtualAgentConfigs = virtualMembers.map((member) => ({
          // Metadata
          avatar: member.agent.avatar,
          backgroundColor: member.agent.backgroundColor,
          // Config
          chatConfig: member.agent.chatConfig,
          description: member.agent.description,
          fewShots: member.agent.fewShots,

          model: member.agent.model,
          openingMessage: member.agent.openingMessage,
          openingQuestions: member.agent.openingQuestions,
          params: member.agent.params,
          plugins: member.agent.plugins,
          provider: member.agent.provider,
          systemRole: member.agent.systemRole,
          tags: member.agent.tags,
          title: member.agent.title,
          tts: member.agent.tts,
          // User & virtual flag
          userId: this.userId,
          virtual: true,
        }));

        const newVirtualAgents = await trx.insert(agents).values(virtualAgentConfigs).returning();

        // Map old agent IDs to new agent IDs
        for (const [i, virtualMember] of virtualMembers.entries()) {
          newVirtualAgentMap.set(virtualMember.agent.id, newVirtualAgents[i].id);
        }
      }

      // 7. Create group-agent relationships
      const groupAgentValues: NewChatGroupAgent[] = [
        // Supervisor
        {
          agentId: newSupervisor.id,
          chatGroupId: newGroup.id,
          order: -1,
          role: 'supervisor',
          userId: this.userId,
        },
        // Virtual members (using new copied agents)
        ...virtualMembers.map((member) => ({
          agentId: newVirtualAgentMap.get(member.agent.id)!,
          chatGroupId: newGroup.id,
          enabled: member.enabled,
          order: member.order,
          role: member.role || 'participant',
          userId: this.userId,
        })),
        // Non-virtual members (referencing same agents - only add relationship)
        ...nonVirtualMembers.map((member) => ({
          agentId: member.agent.id,
          chatGroupId: newGroup.id,
          enabled: member.enabled,
          order: member.order,
          role: member.role || 'participant',
          userId: this.userId,
        })),
      ];

      await trx.insert(chatGroupsAgents).values(groupAgentValues);

      return {
        groupId: newGroup.id,
        supervisorAgentId: newSupervisor.id,
      };
    });
  }
}
