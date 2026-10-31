import { and, asc, eq, inArray } from 'drizzle-orm';

import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../../models/agentTransferJob';
import type { AgentItem, NewChatGroupAgent } from '../../schemas';
import { agents, chatGroups, chatGroupsAgents } from '../../schemas';
import { GROUP_SUPERVISOR_ROLE, resolveGroupMembershipType } from '../../utils/groupMembership';
import { AGENT_GROUP_COPY_SOURCE_MOVED, GROUP_HAS_INACCESSIBLE_MEMBER } from './constants';
import { copyGroupConversationHistory } from './copyHistory';
import type { AgentGroupScope } from './scope';
import { buildCopiedAgent } from './utils';

export interface CopyAgentGroupToWorkspaceOptions {
  includeConversationHistory?: boolean;
  newTitle?: string;
  /**
   * Visibility of the copied group + its member agents within the target
   * workspace. Ignored when copying to a personal account.
   */
  targetVisibility?: 'private' | 'public';
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
export const duplicateGroup = async (
  scope: AgentGroupScope,
  groupId: string,
  newTitle?: string,
): Promise<{ groupId: string; supervisorAgentId: string } | null> => {
  // 1. Get the source group
  const sourceGroup = await scope.db.query.chatGroups.findFirst({
    where: and(eq(chatGroups.id, groupId), scope.groupOwnership()),
  });

  if (!sourceGroup) return null;

  // 2. Get all agents in the group with their details
  const groupAgentsWithDetails = await scope.db
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
  return scope.db.transaction(async (trx) => {
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
        userId: scope.userId,
        workspaceId: scope.workspaceId ?? null,
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
        userId: scope.userId,
        virtual: true,
        // Synthetic agents stay in lockstep with their group, the same way
        // creation and `setVisibility` keep them. Left to the column default
        // they would be workspace-visible while the group stays private.
        visibility: sourceGroup.visibility,
        workspaceId: scope.workspaceId ?? null,
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
        userId: scope.userId,
        virtual: true,
        visibility: sourceGroup.visibility,
        workspaceId: scope.workspaceId ?? null,
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
        userId: scope.userId,
        workspaceId: scope.workspaceId ?? null,
      },
      // Owned members (using new copied agents)
      ...virtualMembers.map((member) => ({
        agentId: newVirtualAgentMap.get(member.agent.id)!,
        chatGroupId: newGroup.id,
        enabled: member.enabled,
        order: member.order,
        role: member.role || 'participant',
        userId: scope.userId,
        workspaceId: scope.workspaceId ?? null,
      })),
      // Referenced members (pointing at the same agents - only add relationship)
      ...nonVirtualMembers.map((member) => ({
        agentId: member.agent.id,
        chatGroupId: newGroup.id,
        enabled: member.enabled,
        order: member.order,
        role: member.role || 'participant',
        userId: scope.userId,
        workspaceId: scope.workspaceId ?? null,
      })),
    ];

    await trx.insert(chatGroupsAgents).values(groupAgentValues);

    return {
      groupId: newGroup.id,
      supervisorAgentId: newSupervisor.id,
    };
  });
};

/**
 * Fork a group into another scope. With `includeConversationHistory`, a
 * heavy group defers its thread/message duplication to a `copy` history job
 * and returns its id — the caller must kick the job driver after the
 * transaction commits, or the copy stalls until the resume safety net runs.
 */
export const copyGroupToWorkspace = async (
  scope: AgentGroupScope,
  groupId: string,
  targetWorkspaceId: string | null,
  targetUserId: string,
  optionsOrNewTitle?: CopyAgentGroupToWorkspaceOptions | string,
): Promise<{ copyJobId: string | null; groupId: string; supervisorAgentId: string } | null> => {
  const options =
    typeof optionsOrNewTitle === 'string'
      ? { newTitle: optionsOrNewTitle }
      : (optionsOrNewTitle ?? {});
  const sourceGroup = await scope.db.query.chatGroups.findFirst({
    where: and(eq(chatGroups.id, groupId), scope.groupOwnership()),
  });

  if (!sourceGroup) return null;

  const groupAgentsWithDetails = await scope.db
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

  return scope.db.transaction(async (trx) => {
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
        .where(and(eq(chatGroups.id, groupId), scope.groupOwnership()))
        .for('update');
      if (!lockedSource) throw new Error(AGENT_GROUP_COPY_SOURCE_MOVED);

      // A pending transfer still owns this group's message rewrite: its
      // topics would be copied mid-migration, and the copy's own drain would
      // race the transfer's over the same rows.
      if (await AgentTransferJobModel.hasPendingJobForGroups(trx, [groupId]))
        throw new Error(AGENT_TRANSFER_IN_PROGRESS);
      if (await AgentCopyJobModel.hasPendingCopyJobForSourceGroups(trx, [groupId], scope.userId))
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
            scope.agentOwnership(),
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
        buildCopiedAgent(
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
            buildCopiedAgent(
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
      ? await copyGroupConversationHistory(scope, {
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
};
