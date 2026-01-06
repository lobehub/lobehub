import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { AgentGroupDetail, AgentGroupMember } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, eq, inArray } from 'drizzle-orm';

import {
  AgentItem,
  ChatGroupItem,
  NewChatGroup,
  NewChatGroupAgent,
  agents,
  chatGroups,
  chatGroupsAgents,
} from '../../schemas';
import { LobeChatDatabase } from '../../type';
import { ChatGroupConfig } from '../../types/chatGroup';

export interface SupervisorAgentConfig {
  model?: string;
  provider?: string;
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
      const groupConfig = group.config as ChatGroupConfig | undefined;

      // Create supervisor agent (virtual agent)
      const [supervisorAgent] = await this.db
        .insert(agents)
        .values({
          model: groupConfig?.orchestratorModel,
          provider: groupConfig?.orchestratorProvider,
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
    const groupConfig = groupParams.config as ChatGroupConfig | undefined;

    // 1. Create supervisor agent (virtual agent)
    const [supervisorAgent] = await this.db
      .insert(agents)
      .values({
        model: supervisorConfig?.model ?? groupConfig?.orchestratorModel,
        provider: supervisorConfig?.provider ?? groupConfig?.orchestratorProvider,
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
}
