import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { AgentGroupDetail, AgentGroupMember, AgentPluginEntry } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, eq, inArray, ne, not, sql } from 'drizzle-orm';

import type {
  AgentItem,
  ChatGroupItem,
  NewAgent,
  NewChatGroup,
  NewChatGroupAgent,
} from '../../schemas';
import {
  agents,
  chatGroups,
  chatGroupsAgents,
  messagePlugins,
  messages,
  threads,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { idGenerator } from '../../utils/idGenerator';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { buildWorkspaceWhere } from '../../utils/workspace';

interface CopyAgentGroupToWorkspaceOptions {
  includeConversationHistory?: boolean;
  newTitle?: string;
  /**
   * Visibility of the copied group + its member agents within the target
   * workspace. Ignored when copying to a personal account.
   */
  targetVisibility?: 'private' | 'public';
}

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
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Workspace-aware ownership predicate for the `chat_groups` table. In personal
   * mode (`workspaceId` absent) matches `user_id = ? AND workspace_id IS NULL`;
   * in team mode matches `workspace_id = ?` (shared with all members).
   */
  private groupOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroups);
  private agentOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents);
  private groupAgentOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroupsAgents);
  private topicOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics);
  private threadOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads);
  private messageOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);
  private messagePluginOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messagePlugins);

  private buildCopiedAgent = (
    source: AgentItem | undefined,
    targetWorkspaceId: string | null,
    targetUserId: string,
    fallbackTitle: string,
    targetVisibility?: 'private' | 'public',
  ): NewAgent => ({
    agencyConfig: source?.agencyConfig,
    avatar: source?.avatar,
    backgroundColor: source?.backgroundColor,
    chatConfig: source?.chatConfig,
    description: source?.description,
    editorData: source?.editorData,
    fewShots: source?.fewShots,
    model: source?.model,
    openingMessage: source?.openingMessage,
    openingQuestions: source?.openingQuestions,
    params: source?.params,
    pinned: source?.pinned,
    plugins: source?.plugins,
    provider: source?.provider,
    systemRole: source?.systemRole,
    tags: source?.tags,
    title: source?.title || fallbackTitle,
    tts: source?.tts,
    userId: targetUserId,
    virtual: source?.virtual ?? true,
    ...(targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {}),
    workspaceId: targetWorkspaceId,
  });

  private remapToolIds = (tools: unknown, toolIdMap: Map<string, string>) => {
    if (!Array.isArray(tools)) return tools;

    return tools.map((tool) => {
      if (!tool || typeof tool !== 'object') return tool;

      const toolRecord = tool as Record<PropertyKey, unknown>;
      const toolId = toolRecord.id;
      if (typeof toolId !== 'string') return tool;

      return {
        ...toolRecord,
        id: toolIdMap.get(toolId) ?? toolId,
      };
    });
  };

  private copyGroupConversationHistory = async ({
    agentIdMap,
    executor,
    newGroupId,
    sourceGroupId,
    targetUserId,
    targetWorkspaceId,
  }: {
    agentIdMap: Map<string, string>;
    executor: LobeChatDatabase;
    newGroupId: string;
    sourceGroupId: string;
    targetUserId: string;
    targetWorkspaceId: string | null;
  }) => {
    const mapAgentId = (agentId?: null | string) =>
      agentId ? (agentIdMap.get(agentId) ?? null) : null;
    const mapTargetId = (targetId?: null | string) => {
      if (!targetId || targetId === 'user') return targetId ?? null;

      return agentIdMap.get(targetId) ?? null;
    };

    const sourceTopics = await executor.query.topics.findMany({
      orderBy: (topic, { asc }) => [asc(topic.createdAt)],
      where: and(this.topicOwnership(), eq(topics.groupId, sourceGroupId)),
    });

    if (sourceTopics.length === 0) return;

    const sourceTopicIds = sourceTopics.map((topic) => topic.id);
    const topicIdMap = new Map(sourceTopics.map((topic) => [topic.id, idGenerator('topics')]));

    const sourceThreads = await executor.query.threads.findMany({
      orderBy: (thread, { asc }) => [asc(thread.createdAt)],
      where: and(this.threadOwnership(), inArray(threads.topicId, sourceTopicIds)),
    });

    const threadIdMap = new Map(
      sourceThreads.map((thread) => [thread.id, idGenerator('threads', 16)]),
    );

    const sourceMessages = await executor.query.messages.findMany({
      orderBy: (message, { asc }) => [asc(message.createdAt)],
      where: and(this.messageOwnership(), inArray(messages.topicId, sourceTopicIds)),
    });

    const messageIdMap = new Map(
      sourceMessages.map((message) => [message.id, idGenerator('messages')]),
    );

    const toolIdMap = new Map<string, string>();
    for (const message of sourceMessages) {
      if (!Array.isArray(message.tools)) continue;

      for (const tool of message.tools) {
        if (!tool || typeof tool !== 'object') continue;

        const toolId = (tool as Record<PropertyKey, unknown>).id;
        if (typeof toolId === 'string') {
          toolIdMap.set(toolId, `toolu_${idGenerator('messages')}`);
        }
      }
    }

    await executor.insert(topics).values(
      sourceTopics.map((topic) => ({
        ...topic,
        agentId: mapAgentId(topic.agentId),
        clientId: null,
        groupId: newGroupId,
        id: topicIdMap.get(topic.id),
        sessionId: null,
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      })),
    );

    if (sourceThreads.length > 0) {
      await executor.insert(threads).values(
        sourceThreads.map((thread) => ({
          ...thread,
          agentId: mapAgentId(thread.agentId),
          clientId: null,
          groupId: newGroupId,
          id: threadIdMap.get(thread.id),
          parentThreadId: thread.parentThreadId
            ? (threadIdMap.get(thread.parentThreadId) ?? null)
            : null,
          sourceMessageId: thread.sourceMessageId
            ? (messageIdMap.get(thread.sourceMessageId) ?? null)
            : null,
          topicId: topicIdMap.get(thread.topicId),
          userId: targetUserId,
          workspaceId: targetWorkspaceId,
        })),
      );
    }

    if (sourceMessages.length === 0) return;

    const sourceMessageIds = sourceMessages.map((message) => message.id);
    const sourcePlugins = await executor.query.messagePlugins.findMany({
      where: and(this.messagePluginOwnership(), inArray(messagePlugins.id, sourceMessageIds)),
    });

    const messageRows = sourceMessages.map((message) => {
      const newMessageId = messageIdMap.get(message.id)!;
      const newTopicId = message.topicId ? (topicIdMap.get(message.topicId) ?? null) : null;

      return {
        ...message,
        agentId: mapAgentId(message.agentId),
        clientId: null,
        groupId: newGroupId,
        id: newMessageId,
        messageGroupId: null,
        parentId: message.parentId ? (messageIdMap.get(message.parentId) ?? null) : null,
        quotaId: message.quotaId ? (messageIdMap.get(message.quotaId) ?? null) : null,
        sessionId: null,
        targetId: mapTargetId(message.targetId),
        threadId: message.threadId ? (threadIdMap.get(message.threadId) ?? null) : null,
        tools: this.remapToolIds(message.tools, toolIdMap),
        topicId: newTopicId,
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      };
    });

    await executor.insert(messages).values(messageRows);

    if (sourcePlugins.length > 0) {
      await executor.insert(messagePlugins).values(
        sourcePlugins
          .map((plugin) => {
            const newMessageId = messageIdMap.get(plugin.id);
            if (!newMessageId) return;

            return {
              ...plugin,
              clientId: null,
              id: newMessageId,
              toolCallId: plugin.toolCallId ? (toolIdMap.get(plugin.toolCallId) ?? null) : null,
              userId: targetUserId,
              workspaceId: targetWorkspaceId,
            };
          })
          .filter((plugin) => !!plugin),
      );
    }
  };

  /**
   * Find a chat group by ID with its associated agents.
   * If no supervisor exists, a virtual supervisor agent is automatically created.
   * @param groupId - The chat group ID
   * @returns AgentGroupDetail with group info, agents array, and supervisor agent ID
   */
  async findByIdWithAgents(groupId: string): Promise<AgentGroupDetail | null> {
    // 1. Find the group
    const group = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, groupId), this.groupOwnership()),
    });

    if (!group) return null;

    // 2. Find all agents associated with this group (including role info). The
    // roster is fetched raw (no visibility filter) with a per-row `visible`
    // flag: supervisor existence must be judged on the raw rows — otherwise a
    // viewer who can't see the supervisor would auto-create a duplicate one
    // below — while a member agent switched back to private must not leak its
    // config to other members (LOBE-11772), so only visible rows are returned.
    const groupAgentsWithDetails = await this.db
      .select({
        agent: agents,
        order: chatGroupsAgents.order,
        role: chatGroupsAgents.role,
        visible: sql<boolean>`(${this.agentOwnership()})`,
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
        role: 'supervisor',
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
  async createGroupWithSupervisor(
    groupParams: Omit<NewChatGroup, 'userId'>,
    agentMembers: string[] = [],
    supervisorConfig?: SupervisorAgentConfig,
  ): Promise<CreateGroupWithSupervisorResult> {
    // Mirror the group's visibility onto the synthetic supervisor agent so
    // workspace members don't see a stray supervisor when the parent group is
    // private. Defaults to 'public' to match the column default.
    const groupVisibility = groupParams.visibility ?? 'public';

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
    const [group] = await this.db
      .insert(chatGroups)
      .values({ ...groupParams, userId: this.userId, workspaceId: this.workspaceId ?? null })
      .returning();

    // 3. Add supervisor agent to group with role 'supervisor'
    const supervisorGroupAgent: NewChatGroupAgent = {
      agentId: supervisorAgent.id,
      chatGroupId: group.id,
      order: -1, // Supervisor always first (negative order)
      role: 'supervisor',
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
        slug: agents.slug,
        title: agents.title,
        virtual: agents.virtual,
      })
      .from(agents)
      .where(and(this.agentOwnership(), inArray(agents.id, agentIds)));

    const virtualAgents: RemoveAgentsCheckResult['virtualAgents'] = [];
    const nonVirtualAgentIds: string[] = [];

    for (const agent of agentDetails) {
      if (agent.virtual) {
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

    // 2. Remove all agents from the group (batch delete from junction table).
    // Scope by the caller's ownership so a client-supplied groupId can only touch
    // the caller's own junction rows — never another user's group membership (IDOR).
    const removed = await this.db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          inArray(chatGroupsAgents.agentId, agentIds),
          this.groupAgentOwnership(),
        ),
      )
      .returning({ agentId: chatGroupsAgents.agentId });

    // 3. Delete virtual agents if requested
    // Note: Virtual agents are standalone (no associated sessions), so we can delete them directly
    // The messages sent by these agents in the group chat will remain (orphaned agentId reference)
    if (deleteVirtualAgents && virtualAgentIds.length > 0) {
      await this.db
        .delete(agents)
        .where(and(this.agentOwnership(), inArray(agents.id, virtualAgentIds)));
    }

    return {
      deletedVirtualAgentIds: deleteVirtualAgents ? virtualAgentIds : [],
      removedFromGroup: removed.length,
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
      where: and(eq(chatGroups.id, groupId), this.groupOwnership()),
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
          workspaceId: this.workspaceId ?? null,
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
          workspaceId: this.workspaceId ?? null,
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
          workspaceId: this.workspaceId ?? null,
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
          workspaceId: this.workspaceId ?? null,
        },
        // Virtual members (using new copied agents)
        ...virtualMembers.map((member) => ({
          agentId: newVirtualAgentMap.get(member.agent.id)!,
          chatGroupId: newGroup.id,
          enabled: member.enabled,
          order: member.order,
          role: member.role || 'participant',
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
        // Non-virtual members (referencing same agents - only add relationship)
        ...nonVirtualMembers.map((member) => ({
          agentId: member.agent.id,
          chatGroupId: newGroup.id,
          enabled: member.enabled,
          order: member.order,
          role: member.role || 'participant',
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      ];

      await trx.insert(chatGroupsAgents).values(groupAgentValues);

      return {
        groupId: newGroup.id,
        supervisorAgentId: newSupervisor.id,
      };
    });
  }

  /**
   * Whether the group's transfer cascade (member agents + group topics /
   * threads / messages) contains rows created by someone else. Transfers
   * rehome every cascaded row, so non-owner members must not move a group
   * that carries teammates' agents or conversations.
   */
  async transferHasForeignRows(groupId: string): Promise<boolean> {
    const agentLinks = await this.db
      .select({ agentId: chatGroupsAgents.agentId })
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, groupId));
    const agentIds = agentLinks.map((link) => link.agentId);

    if (agentIds.length > 0) {
      const [foreignAgent] = await this.db
        .select({ id: agents.id })
        .from(agents)
        .where(and(inArray(agents.id, agentIds), ne(agents.userId, this.userId)))
        .limit(1);
      if (foreignAgent) return true;
    }

    const [foreignTopic] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.groupId, groupId), ne(topics.userId, this.userId)))
      .limit(1);
    if (foreignTopic) return true;

    const [foreignThread] = await this.db
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.groupId, groupId), ne(threads.userId, this.userId)))
      .limit(1);
    if (foreignThread) return true;

    const [foreignMessage] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.groupId, groupId), ne(messages.userId, this.userId)))
      .limit(1);
    return !!foreignMessage;
  }

  async transferToWorkspace(
    groupId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ groupId: string } | null> {
    const sourceGroup = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, groupId), this.groupOwnership()),
    });

    if (!sourceGroup) return null;

    return this.db.transaction(async (trx) => {
      const memberRows = await trx
        .select({ agentId: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, groupId));

      const agentIds = memberRows.map((row) => row.agentId);
      const ownershipUpdate = {
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      };
      // Only apply visibility when the destination is a workspace —
      // in personal scope every row is implicitly private and the
      // field is ignored.
      const visibilityUpdate =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

      await trx
        .update(chatGroups)
        .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: new Date() })
        .where(eq(chatGroups.id, groupId));

      await trx
        .update(chatGroupsAgents)
        .set(ownershipUpdate)
        .where(eq(chatGroupsAgents.chatGroupId, groupId));

      if (agentIds.length > 0) {
        await trx
          .delete(chatGroupsAgents)
          .where(
            and(
              inArray(chatGroupsAgents.agentId, agentIds),
              not(eq(chatGroupsAgents.chatGroupId, groupId)),
            ),
          );

        await trx
          .update(agents)
          .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: new Date() })
          .where(inArray(agents.id, agentIds));
      }

      const groupTopics = await trx
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.groupId, groupId));
      const groupTopicIds = groupTopics.map((topic) => topic.id);

      await trx.update(topics).set(ownershipUpdate).where(eq(topics.groupId, groupId));
      await trx.update(threads).set(ownershipUpdate).where(eq(threads.groupId, groupId));
      await trx.update(messages).set(ownershipUpdate).where(eq(messages.groupId, groupId));

      if (groupTopicIds.length > 0) {
        await trx
          .update(threads)
          .set(ownershipUpdate)
          .where(inArray(threads.topicId, groupTopicIds));
        await trx
          .update(messages)
          .set(ownershipUpdate)
          .where(inArray(messages.topicId, groupTopicIds));
      }

      return { groupId };
    });
  }

  async copyToWorkspace(
    groupId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    optionsOrNewTitle?: CopyAgentGroupToWorkspaceOptions | string,
  ): Promise<{ groupId: string; supervisorAgentId: string } | null> {
    const options =
      typeof optionsOrNewTitle === 'string'
        ? { newTitle: optionsOrNewTitle }
        : (optionsOrNewTitle ?? {});
    const sourceGroup = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, groupId), this.groupOwnership()),
    });

    if (!sourceGroup) return null;

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

    const sourceSupervisor = groupAgentsWithDetails.find((row) => row.role === 'supervisor');
    const sourceMembers = groupAgentsWithDetails.filter((row) => row.role !== 'supervisor');

    // Only apply visibility when copying INTO a workspace — in personal
    // scope visibility is a no-op and the DB defaults win.
    const targetVisibility =
      targetWorkspaceId && options.targetVisibility ? options.targetVisibility : undefined;

    return this.db.transaction(async (trx) => {
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
          title: options.newTitle || (sourceGroup.title ? `${sourceGroup.title} (Copy)` : 'Copy'),
          userId: targetUserId,
          ...(targetVisibility ? { visibility: targetVisibility } : {}),
          workspaceId: targetWorkspaceId,
        })
        .returning();

      const [newSupervisor] = await trx
        .insert(agents)
        .values(
          this.buildCopiedAgent(
            sourceSupervisor?.agent,
            targetWorkspaceId,
            targetUserId,
            'Supervisor',
            targetVisibility,
          ),
        )
        .returning();

      const memberAgentIdMap = new Map<string, string>();
      if (sourceMembers.length > 0) {
        const newMembers = await trx
          .insert(agents)
          .values(
            sourceMembers.map((member) =>
              this.buildCopiedAgent(
                member.agent,
                targetWorkspaceId,
                targetUserId,
                'Agent',
                targetVisibility,
              ),
            ),
          )
          .returning({ id: agents.id });

        for (const [index, member] of sourceMembers.entries()) {
          memberAgentIdMap.set(member.agent.id, newMembers[index].id);
        }
      }

      const groupAgentValues: NewChatGroupAgent[] = [
        {
          agentId: newSupervisor.id,
          chatGroupId: newGroup.id,
          order: -1,
          role: 'supervisor',
          userId: targetUserId,
          workspaceId: targetWorkspaceId,
        },
        ...sourceMembers.map((member) => ({
          agentId: memberAgentIdMap.get(member.agent.id)!,
          chatGroupId: newGroup.id,
          enabled: member.enabled,
          order: member.order,
          role: member.role || 'participant',
          userId: targetUserId,
          workspaceId: targetWorkspaceId,
        })),
      ];

      await trx.insert(chatGroupsAgents).values(groupAgentValues);

      const agentIdMap = new Map<string, string>();
      if (sourceSupervisor?.agent.id) {
        agentIdMap.set(sourceSupervisor.agent.id, newSupervisor.id);
      }
      for (const [sourceAgentId, newAgentId] of memberAgentIdMap) {
        agentIdMap.set(sourceAgentId, newAgentId);
      }

      if (options.includeConversationHistory) {
        await this.copyGroupConversationHistory({
          agentIdMap,
          executor: trx,
          newGroupId: newGroup.id,
          sourceGroupId: groupId,
          targetUserId,
          targetWorkspaceId,
        });
      }

      return {
        groupId: newGroup.id,
        supervisorAgentId: newSupervisor.id,
      };
    });
  }
}
