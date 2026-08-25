import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { AgentGroupDetail, AgentGroupMember, AgentPluginEntry } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, asc, count, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';

import {
  AGENT_COPY_IN_PROGRESS,
  AgentCopyJobModel,
  getAgentCopySyncMessageThreshold,
} from '../../models/agentCopyJob';
import {
  AGENT_TRANSFER_IN_PROGRESS,
  AgentTransferJobModel,
  getAgentTransferSyncMessageThreshold,
  remapMessageAgentIdsForTopics,
  remapResidualMessageAgentIds,
  rewriteMessageScopeForTopics,
  rewriteResidualMessageScope,
} from '../../models/agentTransferJob';
import {
  hasForeignTopicComments,
  syncTopicCommentsOnTopicTransfer,
  TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
} from '../../models/topicComment';
import type {
  AgentItem,
  ChatGroupItem,
  NewAgent,
  NewChatGroup,
  NewChatGroupAgent,
} from '../../schemas';
import {
  agentLabelAssignments,
  agents,
  chatGroups,
  chatGroupsAgents,
  messages,
  sessionGroups,
  threads,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { insertInBatches, splitCrossBatchSelfReferences } from '../../utils/batchInsert';
import { COPIED_TOPIC_USAGE_RESET } from '../../utils/copiedTranscript';
import { copyMessagesInDatabase, type IdPair } from '../../utils/copyMessagesInDatabase';
import { GROUP_SUPERVISOR_ROLE, resolveGroupMembershipType } from '../../utils/groupMembership';
import { idGenerator } from '../../utils/idGenerator';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Copy-with-history rejected: the source group left this scope between the
 * ownership read and the row lock (a concurrent transfer committed).
 */
/** Slugs owned by builtin provisioning; a roster removal must never reach one. */
const RESERVED_BUILTIN_AGENT_SLUGS: string[] = Object.values(BUILTIN_AGENT_SLUGS);

export const AGENT_GROUP_COPY_SOURCE_MOVED = 'AGENT_GROUP_COPY_SOURCE_MOVED';

/**
 * Transfer rejected: the group references a member agent this caller cannot
 * see, and moving the group would clone that agent — config and all — into a
 * scope the caller can read.
 */
export const GROUP_HAS_INACCESSIBLE_MEMBER = 'GROUP_HAS_INACCESSIBLE_MEMBER';

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

  /**
   * Duplicate a group's conversations into the freshly created target group,
   * under the same fast/slow split as the agent copy path:
   *
   * - ≤ threshold — topics, threads and messages all copy inside the caller's
   *   transaction; behavior identical to the historical synchronous path.
   * - \> threshold — only the topic SHELLS are created here; thread + message
   *   duplication becomes a `copy` history job drained one topic at a time
   *   (see `AgentCopyJobModel`). Inserting a message row maintains every
   *   message index including the multi-GB BM25 one (~5ms/row in production),
   *   so a heavy group would otherwise hold a pooled connection for minutes.
   *
   * Returns the job id when the slow path was taken; the caller kicks the job
   * driver AFTER its transaction commits.
   */
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
  }): Promise<{ copyJobId: string | null }> => {
    const mapAgentId = (agentId?: null | string) =>
      agentId ? (agentIdMap.get(agentId) ?? null) : null;

    const sourceTopics = await executor.query.topics.findMany({
      orderBy: (topic, { asc }) => [asc(topic.createdAt)],
      where: and(this.topicOwnership(), eq(topics.groupId, sourceGroupId)),
    });

    if (sourceTopics.length === 0) return { copyJobId: null };

    const sourceTopicIds = sourceTopics.map((topic) => topic.id);
    const topicIdMap = new Map(sourceTopics.map((topic) => [topic.id, idGenerator('topics')]));

    const [{ sourceMessages }] = await executor
      .select({ sourceMessages: count() })
      .from(messages)
      .where(and(this.messageOwnership(), inArray(messages.topicId, sourceTopicIds)));

    // Topic shells go in on both paths — they are what makes the copied group
    // usable immediately, and what the queue rows / gray-out UI key on.
    await insertInBatches(
      sourceTopics.map((topic) => ({
        ...topic,
        ...COPIED_TOPIC_USAGE_RESET,
        agentId: mapAgentId(topic.agentId),
        clientId: null,
        groupId: newGroupId,
        id: topicIdMap.get(topic.id),
        sessionId: null,
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      })),
      (batch) => executor.insert(topics).values(batch),
    );

    if (sourceMessages > getAgentCopySyncMessageThreshold()) {
      const copyJobId = await AgentCopyJobModel.createJob(executor, {
        agents: [...agentIdMap.entries()].map(([sourceAgentId, newAgentId]) => ({
          newAgentId,
          sourceAgentId,
        })),
        group: { newGroupId, sourceGroupId },
        source: { userId: this.userId, workspaceId: this.workspaceId ?? null },
        target: { userId: targetUserId, workspaceId: targetWorkspaceId },
        topics: sourceTopics.map((topic) => ({
          activityAt: topic.updatedAt ?? topic.createdAt ?? new Date(),
          newTopicId: topicIdMap.get(topic.id)!,
          sourceTopicId: topic.id,
        })),
      });
      return { copyJobId };
    }

    const sourceThreads = await executor.query.threads.findMany({
      orderBy: (thread, { asc }) => [asc(thread.createdAt)],
      where: and(this.threadOwnership(), inArray(threads.topicId, sourceTopicIds)),
    });

    const threadIdMap = new Map(
      sourceThreads.map((thread) => [thread.id, idGenerator('threads', 16)]),
    );

    // Message bodies never leave the database — only the ids are fetched to
    // build the remap tables consumed by the in-database copy below (threads
    // also need the complete message map for `sourceMessageId`).
    const messageIdPairs: IdPair[] = (
      await executor.query.messages.findMany({
        columns: { id: true },
        where: and(this.messageOwnership(), inArray(messages.topicId, sourceTopicIds)),
      })
    ).map(({ id }) => [id, idGenerator('messages')]);

    const messageIdMap = new Map(messageIdPairs);

    if (sourceThreads.length > 0) {
      const { fixups: threadFixups, rows: threadRows } = splitCrossBatchSelfReferences(
        sourceThreads.map((thread) => ({
          ...thread,
          agentId: mapAgentId(thread.agentId),
          clientId: null,
          groupId: newGroupId,
          id: threadIdMap.get(thread.id)!,
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
        ['parentThreadId'],
      );

      await insertInBatches(threadRows, (batch) => executor.insert(threads).values(batch));

      for (const fixup of threadFixups) {
        await executor.update(threads).set(fixup.patch).where(eq(threads.id, fixup.id));
      }
    }

    // `agent_id` remaps through the group-member map (unknown → NULL);
    // `target_id` keeps the literal 'user' and remaps agent targets the same way.
    await copyMessagesInDatabase({
      agentIdExpr: sql`_amap.new_id`,
      agentIdPairs: [...agentIdMap.entries()],
      executor,
      groupId: newGroupId,
      messageIdPairs,
      childScope: (table) =>
        buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, table),
      targetIdExpr: sql`case when ${messages.targetId} = 'user' then ${messages.targetId} else _amap_target.new_id end`,
      targetUserId,
      targetWorkspaceId,
      threadIdPairs: [...threadIdMap.entries()],
      topicIdPairs: [...topicIdMap.entries()],
    });

    return { copyJobId: null };
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
    // config to other members, so only visible rows are returned.
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
      .where(and(this.agentOwnership(), inArray(agents.id, agentIds)));

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
        .where(and(inArray(agents.id, agentIds), this.agentOwnership()))
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
            this.groupAgentOwnership(),
          ),
        )
        .returning({ agentId: chatGroupsAgents.agentId });

      // 3. Delete virtual agents if requested
      // Note: Virtual agents are standalone (no associated sessions), so we can delete them directly
      // The messages sent by these agents in the group chat will remain (orphaned agentId reference)
      if (deleteVirtualAgents && virtualAgentIds.length > 0) {
        await trx.delete(agents).where(
          and(
            this.agentOwnership(),
            inArray(agents.id, virtualAgentIds),
            // Same backstop as `ChatGroupModel.delete`: builtins (Inbox, the
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
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId);

    // 3. Separate supervisor, owned members, and referenced members. This is
    //    the same three-way split every other path now shares: an owned member
    //    has no life outside its group, so the copy needs its own; a referenced
    //    member is a standalone agent both groups can point at.
    let sourceSupervisor: (typeof groupAgentsWithDetails)[number] | undefined;
    const virtualMembers: (typeof groupAgentsWithDetails)[number][] = [];
    const nonVirtualMembers: (typeof groupAgentsWithDetails)[number][] = [];

    for (const row of groupAgentsWithDetails) {
      if (row.role === GROUP_SUPERVISOR_ROLE) {
        sourceSupervisor = row;
      } else if (
        resolveGroupMembershipType({
          role: row.role,
          slug: row.agent.slug,
          virtual: row.agent.virtual,
        }) === 'owned'
      ) {
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
          // Sidebar folder placement is shared state, so the copy lands next to
          // its source (matching AgentModel.duplicate's `sessionGroupId`).
          groupId: sourceGroup.groupId,
          // Visibility travels with the folder, and must: the column defaults
          // to `public`, so duplicating a private group would otherwise publish
          // the copy to the workspace *and* strand it — the sidebar resolves a
          // public item's folder only against public folders, so the copy would
          // land in Ungrouped rather than beside its source.
          visibility: sourceGroup.visibility,
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
          // Synthetic agents stay in lockstep with their group, the same way
          // creation and `setVisibility` keep them. Left to the column default
          // they would be workspace-visible while the group stays private.
          visibility: sourceGroup.visibility,
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
          visibility: sourceGroup.visibility,
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
          role: GROUP_SUPERVISOR_ROLE,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        },
        // Owned members (using new copied agents)
        ...virtualMembers.map((member) => ({
          agentId: newVirtualAgentMap.get(member.agent.id)!,
          chatGroupId: newGroup.id,
          enabled: member.enabled,
          order: member.order,
          role: member.role || 'participant',
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
        // Referenced members (pointing at the same agents - only add relationship)
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
          this.groupOwnership(),
          // AND on the member agent, exactly as the roster reads do
          // (`memberAgentVisibility`). Seeing the group is not enough: a member
          // whose owner has since flipped it back to `private` is hidden from
          // the roster, and this warning must not be the one surface that
          // hands out its title and avatar.
          this.agentOwnership(),
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

    // Comments move (or die, when the target is personal scope) with their
    // topics — a teammate's comment on the caller's own topic is still their
    // work. NULL authors (deleted accounts) count as foreign too.
    if (await hasForeignTopicComments(this.db, this.userId, eq(topics.groupId, groupId)))
      return true;

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
    options: { rejectForeignTopicCommentAuthors?: boolean } = {},
  ): Promise<{ groupId: string; transferJobId: string | null } | null> {
    const sourceGroup = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, groupId), this.groupOwnership()),
    });

    if (!sourceGroup) return null;

    return this.db.transaction(async (trx) => {
      // Lock the group row first: it is the one serialization point every
      // group-level operation shares, including for a group whose roster is
      // empty (where the member-agent locks below are a no-op).
      //
      // The lock re-asserts the source scope rather than matching by id alone,
      // for the same reason as the copy path below: the scope check above ran
      // outside this transaction, and a racing transfer small enough to take
      // the fast path leaves no pending job behind for the guards to catch —
      // it just moves the group away. An id-only lock would let the loser wake
      // up and transfer it a second time from stale topic state.
      const [lockedSource] = await trx
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(and(eq(chatGroups.id, groupId), this.groupOwnership()))
        .for('update');
      if (!lockedSource) return null;

      const memberRows = await trx
        .select({
          agent: agents,
          agentId: chatGroupsAgents.agentId,
          role: chatGroupsAgents.role,
        })
        .from(chatGroupsAgents)
        .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
        .where(eq(chatGroupsAgents.chatGroupId, groupId));

      const agentIds = memberRows.map((row) => row.agentId);

      // Members split by who owns their lifecycle. Owned members were built for
      // this group and travel with it; referenced members are standalone agents
      // that merely joined, and moving them would drag their own sessions,
      // knowledge bases and cron jobs out from under them — all of which live
      // outside anything a group transfer touches.
      const referencedMembers: typeof memberRows = [];
      const ownedAgentIds: string[] = [];
      for (const row of memberRows) {
        const membership = resolveGroupMembershipType({
          role: row.role,
          slug: row.agent.slug,
          virtual: row.agent.virtual,
        });
        if (membership === 'owned') ownedAgentIds.push(row.agentId);
        else referencedMembers.push(row);
      }

      // Same lock-then-guard as AgentModel.transferAgents: serialize with a
      // concurrent transfer of any member agent BEFORE consulting the pending
      // job table, so two racing transfers cannot both pass the guard.
      if (agentIds.length > 0) {
        await trx
          .select({ id: agents.id })
          .from(agents)
          .where(inArray(agents.id, agentIds))
          .orderBy(asc(agents.id))
          .for('update');
      }

      // `memberRows` is read RAW — the partition above must see every member,
      // including ones hidden from this caller. But a referenced member is
      // about to be CLONED into the target scope, systemRole and config and
      // all, which would hand the caller a full copy of an agent whose owner
      // has since made it private. The roster hides such a member, and so does
      // `listReferencedMembers`; the transfer must not become the way around
      // that.
      //
      // Refuse rather than clone a redacted shell: a member that answers with
      // a blank systemRole is a silent behavior change, and dropping it would
      // leave the moved history attributed to an agent in the source scope
      // (`messages.agent_id` cascades). Neither is the caller's to choose.
      //
      // Deliberately AFTER the lock above, and re-read rather than reusing
      // `memberRows`: that snapshot predates the lock, so an owner committing
      // `visibility = 'private'` in between would have been checked as public
      // and then cloned from the stale row. Once the rows are locked, that
      // update blocks until this transaction ends, so what is checked here is
      // what gets cloned below.
      const lockedReferencedAgents = new Map<string, AgentItem>();
      if (referencedMembers.length > 0) {
        const visibleMembers = await trx
          .select()
          .from(agents)
          .where(
            and(
              inArray(
                agents.id,
                referencedMembers.map((row) => row.agentId),
              ),
              this.agentOwnership(),
            ),
          );

        // Deliberately a bare count, and the error names nobody: which member
        // is hidden is itself the thing being withheld.
        if (visibleMembers.length !== referencedMembers.length) {
          throw new Error(GROUP_HAS_INACCESSIBLE_MEMBER);
        }

        for (const agent of visibleMembers) lockedReferencedAgents.set(agent.id, agent);
      }
      // Both guards are needed: the agent one catches a member agent migrating
      // on its own, the group one catches this group's own backfill (and is
      // the ONLY one that fires when the roster is empty).
      if (
        (await AgentTransferJobModel.hasPendingJobForAgents(trx, agentIds)) ||
        (await AgentTransferJobModel.hasPendingJobForGroups(trx, [groupId]))
      ) {
        throw new Error(AGENT_TRANSFER_IN_PROGRESS);
      }
      // Copy jobs register only their TARGET agents/group in the junctions;
      // guard the source side too, or a transfer would move the topics a
      // pending copy is still reading from.
      if (
        (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, agentIds)) ||
        (await AgentCopyJobModel.hasPendingCopyJobForSourceGroups(trx, [groupId]))
      ) {
        throw new Error(AGENT_COPY_IN_PROGRESS);
      }

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
        // Folders stay in the source scope, exactly as `transferAgents` does
        // for `sessionGroupId`: carrying the id across would point the moved
        // group at a folder the target workspace cannot resolve, dropping it
        // into Ungrouped for every member there.
        .set({
          ...ownershipUpdate,
          ...visibilityUpdate,
          groupId: null,
          // Same reasoning as the folder: a pin is the previous owner's own
          // sidebar choice and would otherwise arrive as a workspace-wide pin.
          pinned: false,
          updatedAt: new Date(),
        })
        .where(eq(chatGroups.id, groupId));

      // The junction rows belong to the GROUP, so all of them follow it —
      // including the rows about to be repointed at clones below.
      //
      // Note what is deliberately NOT here any more: this used to also
      // `DELETE FROM chat_groups_agents WHERE agent_id IN (members) AND
      // chat_group_id <> this group`, silently evicting every member from every
      // OTHER group it belonged to. That only ever made sense as a crude way to
      // stop a moved agent from dangling in a group left behind — which is now
      // structurally impossible: owned members cannot be in a second group, and
      // referenced members no longer move at all.
      await trx
        .update(chatGroupsAgents)
        .set(ownershipUpdate)
        .where(eq(chatGroupsAgents.chatGroupId, groupId));

      if (ownedAgentIds.length > 0) {
        await trx
          .update(agents)
          .set({
            ...ownershipUpdate,
            ...visibilityUpdate,
            // Folders and pins belong to the source scope — same rule the
            // group row and `AgentModel.transferAgents` follow.
            pinned: false,
            sessionGroupId: null,
            updatedAt: new Date(),
          })
          .where(inArray(agents.id, ownedAgentIds));

        // This path moves member agents itself instead of going through
        // `AgentModel.transferAgents`, so it has to repeat that method's
        // cleanup: a label belongs to the source registry and cannot travel.
        // Left behind, the rows keep inflating the source label's usage count
        // and reappear if the agent ever comes back.
        await trx
          .delete(agentLabelAssignments)
          .where(inArray(agentLabelAssignments.agentId, ownedAgentIds));
      }

      // Referenced members stay put; the group gets its own copy of each in the
      // target scope, and the roster row is repointed at that copy.
      //
      // This is the mirror image of what an AGENT transfer does — there the
      // agent leaves and the group loses a member. The rule behind both is the
      // same: whoever is the subject of the operation is kept whole. Moving an
      // agent is about the agent, and the group is collateral; moving a group is
      // about the group, which has to arrive usable, with every voice in its
      // history still resolvable. Do not "fix" one to match the other.
      const agentRemapPairs: { newAgentId: string; sourceAgentId: string }[] = [];
      if (referencedMembers.length > 0) {
        const clones = await trx
          .insert(agents)
          .values(
            referencedMembers.map((member) => ({
              // The row read under the lock above, not the pre-lock snapshot.
              ...this.buildCopiedAgent(
                lockedReferencedAgents.get(member.agentId) ?? member.agent,
                targetWorkspaceId,
                targetUserId,
                'Agent',
                targetVisibility,
              ),
              // The clone exists for this group and nothing else: hidden from
              // the target's agent list, and never offered as a member
              // candidate elsewhere (`buildQueryAgentsWhere` filters virtual).
              // `buildCopiedAgent` would otherwise inherit the source's
              // `virtual: false` and publish a second copy of a private agent
              // into the target scope.
              pinned: false,
              virtual: true,
            })),
          )
          .returning({ id: agents.id });

        for (const [index, member] of referencedMembers.entries()) {
          const newAgentId = clones[index].id;
          agentRemapPairs.push({ newAgentId, sourceAgentId: member.agentId });

          await trx
            .update(chatGroupsAgents)
            .set({ agentId: newAgentId })
            .where(
              and(
                eq(chatGroupsAgents.chatGroupId, groupId),
                eq(chatGroupsAgents.agentId, member.agentId),
              ),
            );
        }
      }

      // `updatedAt` is read here, BEFORE the ownership update: the update below
      // does not preserve it, so `$onUpdate` stamps every group topic with the
      // same instant. The async backfill drains most-recently-active first, and
      // that ordering has to come from real activity, not from transfer time.
      const lockedTopics = await trx
        .select({ id: topics.id, updatedAt: topics.updatedAt })
        .from(topics)
        .where(eq(topics.groupId, groupId))
        .orderBy(asc(topics.id))
        .for('update');
      const activityAtByTopic = new Map(lockedTopics.map((topic) => [topic.id, topic.updatedAt]));

      if (
        options.rejectForeignTopicCommentAuthors &&
        (await hasForeignTopicComments(trx, this.userId, eq(topics.groupId, groupId)))
      ) {
        throw new Error(TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS);
      }

      const movedTopics = await trx
        .update(topics)
        .set(ownershipUpdate)
        .where(eq(topics.groupId, groupId))
        .returning({ id: topics.id, updatedAt: topics.updatedAt });
      const movedTopicIds = movedTopics.map((topic) => topic.id);
      await trx.update(threads).set(ownershipUpdate).where(eq(threads.groupId, groupId));

      // Topic comments denormalize the topic's workspaceId — move them with
      // the topic (or drop them when leaving workspace scope entirely),
      // otherwise workspace-filtered comment reads go stale. See the helper doc.
      await syncTopicCommentsOnTopicTransfer(trx, movedTopicIds, targetWorkspaceId);

      if (movedTopicIds.length > 0) {
        await trx
          .update(threads)
          .set(ownershipUpdate)
          .where(inArray(threads.topicId, movedTopicIds));
      }

      // Repoint the group's own rows from each cloned-away member onto its
      // clone. `topics.agent_id` and `threads.agent_id` are ON DELETE CASCADE,
      // so leaving them aimed at an agent that stayed behind is not merely
      // cosmetic: the day its owner deletes it, these moved rows go with it.
      // One statement per pair — the pair count is the group's External member
      // count, i.e. a handful.
      for (const { newAgentId, sourceAgentId } of agentRemapPairs) {
        await trx
          .update(topics)
          .set({ agentId: newAgentId, updatedAt: topics.updatedAt })
          .where(and(eq(topics.groupId, groupId), eq(topics.agentId, sourceAgentId)));
        await trx
          .update(threads)
          .set({ agentId: newAgentId, updatedAt: threads.updatedAt })
          .where(and(eq(threads.groupId, groupId), eq(threads.agentId, sourceAgentId)));
        if (movedTopicIds.length > 0) {
          await trx
            .update(threads)
            .set({ agentId: newAgentId, updatedAt: threads.updatedAt })
            .where(
              and(inArray(threads.topicId, movedTopicIds), eq(threads.agentId, sourceAgentId)),
            );
        }
      }

      // Message scope rewrite — same fast/slow split as
      // `AgentModel.transferAgents`: rewriting a message row maintains every
      // message index (incl. the multi-GB BM25 index), so a heavy group's
      // history cannot be rewritten inside this transaction. Above the
      // threshold it becomes an async backfill job drained topic-by-topic, and
      // the group conversation surface gates the un-migrated topics
      // (`features/AgentTransferMigration`, keyed by `groupId`).
      const targetScope = { userId: targetUserId, workspaceId: targetWorkspaceId };
      const groupMessages = inArray(messages.groupId, [groupId]);
      const [{ affectedMessages }] = await trx
        .select({ affectedMessages: count() })
        .from(messages)
        .where(
          movedTopicIds.length > 0
            ? or(inArray(messages.topicId, movedTopicIds), groupMessages)
            : groupMessages,
        );

      let transferJobId: string | null = null;
      if (affectedMessages <= getAgentTransferSyncMessageThreshold()) {
        await rewriteMessageScopeForTopics(trx, movedTopicIds, targetScope);
        await rewriteResidualMessageScope(
          trx,
          { agentIds: [], groupIds: [groupId], sessionIds: [] },
          targetScope,
        );
        await remapMessageAgentIdsForTopics(trx, movedTopicIds, agentRemapPairs);
        await remapResidualMessageAgentIds(trx, [groupId], agentRemapPairs);
      } else {
        transferJobId = await AgentTransferJobModel.createJob(trx, {
          // Must mirror the synchronous branch above: the drain applies these
          // to the same rows it rewrites, topic by topic.
          agentIdRemap: agentRemapPairs,
          // The roster AS IT NOW STANDS in the target scope: members that
          // travelled, plus the clones that replaced the ones that didn't.
          // Deliberately NOT the left-behind originals: this junction is also
          // what the migration badge reads, and an agent that never moved
          // should not advertise a migration.
          //
          // Their deletion still has to be blocked for the drain's duration —
          // until it reaches a topic, that topic's rows still point at the
          // original, and `messages.agent_id` cascades. That guard hangs off
          // `payload.agentIdRemap` instead, via
          // `hasPendingRemapForSourceAgents`, so it constrains the delete
          // without touching the badge.
          agentIds: [...ownedAgentIds, ...agentRemapPairs.map((pair) => pair.newAgentId)],
          groupIds: [groupId],
          // Must mirror the synchronous branch above exactly: residual by
          // GROUP only. Member agents are covered (junction rows above) for
          // the guards and the badge, but their own topicless messages are
          // not part of what a group transfer moves.
          residualAgentIds: [],
          sessionIds: [],
          source: { userId: this.userId, workspaceId: this.workspaceId ?? null },
          target: targetScope,
          topics: movedTopics.map((topic) => ({
            activityAt: activityAtByTopic.get(topic.id) ?? topic.updatedAt,
            id: topic.id,
          })),
        });
      }

      return { groupId, transferJobId };
    });
  }

  /**
   * Fork a group into another scope. With `includeConversationHistory`, a
   * heavy group defers its thread/message duplication to a `copy` history job
   * and returns its id — the caller must kick the job driver after the
   * transaction commits, or the copy stalls until the resume safety net runs.
   */
  async copyToWorkspace(
    groupId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    optionsOrNewTitle?: CopyAgentGroupToWorkspaceOptions | string,
  ): Promise<{ copyJobId: string | null; groupId: string; supervisorAgentId: string } | null> {
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
      .orderBy(chatGroupsAgents.order, chatGroupsAgents.createdAt, chatGroupsAgents.agentId);

    const sourceSupervisor = groupAgentsWithDetails.find((row) => row.role === 'supervisor');
    const sourceMembers = groupAgentsWithDetails.filter((row) => row.role !== 'supervisor');

    // Same guard, same reason as `transferToWorkspace`: a copy duplicates each
    // member through `buildCopiedAgent`, systemRole and config included, into a
    // scope this caller reads. The roster hides a member whose owner has since
    // made it private, so copying the group must not be the way to read it.
    //
    // Scoped to REFERENCED members, matching the transfer guard. An owned
    // member is the group's own machinery — the supervisor and the members its
    // builder made — and has always travelled with the group; it is not
    // somebody's separate agent being read through a side door.
    //
    // `duplicate` needs no guard at all: it re-links referenced members rather
    // than copying them, so no config crosses a scope.
    const referencedSourceMembers = sourceMembers.filter(
      (row) =>
        resolveGroupMembershipType({
          role: row.role,
          slug: row.agent.slug,
          virtual: row.agent.virtual,
        }) !== 'owned',
    );
    // Only apply visibility when copying INTO a workspace — in personal
    // scope visibility is a no-op and the DB defaults win.
    const targetVisibility =
      targetWorkspaceId && options.targetVisibility ? options.targetVisibility : undefined;

    return this.db.transaction(async (trx) => {
      const lockedReferencedSourceAgents = new Map<string, AgentItem>();

      if (options.includeConversationHistory) {
        // Lock-then-guard on the SOURCE group, mirroring the agent copy path.
        // The lock re-asserts the source scope rather than matching by id
        // alone: a transfer small enough to run inline leaves no pending job
        // to catch, yet moves the group out of this scope entirely, and an
        // id-only lock would happily queue a copy against now-stale topic ids.
        const [lockedSource] = await trx
          .select({ id: chatGroups.id })
          .from(chatGroups)
          .where(and(eq(chatGroups.id, groupId), this.groupOwnership()))
          .for('update');
        if (!lockedSource) throw new Error(AGENT_GROUP_COPY_SOURCE_MOVED);

        // A pending transfer still owns this group's message rewrite: its
        // topics would be copied mid-migration, and the copy's own drain would
        // race the transfer's over the same rows.
        if (await AgentTransferJobModel.hasPendingJobForGroups(trx, [groupId]))
          throw new Error(AGENT_TRANSFER_IN_PROGRESS);
        if (await AgentCopyJobModel.hasPendingCopyJobForSourceGroups(trx, [groupId], this.userId))
          throw new Error(AGENT_COPY_IN_PROGRESS);
      }

      // Lock the referenced members, then check them on the locked rows —
      // otherwise an owner committing `visibility = 'private'` after the check
      // is still cloned, config and all, from the pre-check snapshot.
      //
      // Ordered AFTER the group lock above, matching `transferToWorkspace`
      // (group, then member agents). Taking the agent locks first would let a
      // concurrent copy and transfer of the same group each hold what the
      // other wants, and deadlock instead of meeting the pending-job guards.
      if (referencedSourceMembers.length > 0) {
        await trx
          .select({ id: agents.id })
          .from(agents)
          .where(
            inArray(
              agents.id,
              referencedSourceMembers.map((row) => row.agent.id),
            ),
          )
          .orderBy(asc(agents.id))
          .for('update');

        const visibleMembers = await trx
          .select()
          .from(agents)
          .where(
            and(
              inArray(
                agents.id,
                referencedSourceMembers.map((row) => row.agent.id),
              ),
              this.agentOwnership(),
            ),
          );

        if (visibleMembers.length !== referencedSourceMembers.length) {
          throw new Error(GROUP_HAS_INACCESSIBLE_MEMBER);
        }

        for (const agent of visibleMembers) lockedReferencedSourceAgents.set(agent.id, agent);
      }

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
                // Referenced members clone from the row read under the lock
                // above; owned members were never in question and keep their
                // pre-transaction snapshot.
                lockedReferencedSourceAgents.get(member.agent.id) ?? member.agent,
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
          role: GROUP_SUPERVISOR_ROLE,
          userId: targetUserId,
          workspaceId: targetWorkspaceId,
        },
        // A copy duplicates EVERY member into the target scope, and the copies
        // keep the source's `virtual` flag (`buildCopiedAgent`), so each copy
        // resolves to the same membership its source had — the copy's
        // `External` badges match the original's row for row.
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

      const { copyJobId } = options.includeConversationHistory
        ? await this.copyGroupConversationHistory({
            agentIdMap,
            executor: trx,
            newGroupId: newGroup.id,
            sourceGroupId: groupId,
            targetUserId,
            targetWorkspaceId,
          })
        : { copyJobId: null };

      return {
        copyJobId,
        groupId: newGroup.id,
        supervisorAgentId: newSupervisor.id,
      };
    });
  }
}
