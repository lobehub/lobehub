import { and, asc, eq, inArray, ne } from 'drizzle-orm';

import { AGENT_SHARED_TRANSFER_BLOCKED } from '../../models/agent';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../../models/agentTransferJob';
import {
  CHAT_GROUP_OWNERSHIP_STALE,
  CHAT_GROUP_TRANSFER_HIDDEN_MEMBER,
} from '../../models/chatGroup/constants';
import {
  agentBotProviders,
  agentCronJobs,
  agents,
  agentShares,
  chatGroups,
  chatGroupsAgents,
  projectAgents,
  projects,
  tasks,
} from '../../schemas';
import type { Transaction } from '../../type';
import { sanitizeAgencyConfigsForWorkspace } from '../../utils/agencyConfigDevices';
import { rehomeAgentConnectorsForRecipient } from '../../utils/agentConnectors';
import { rehomeAgentDocumentsForRecipient } from '../../utils/agentDocumentsOwnership';
import { rehomeAgentExpertiseForRecipient } from '../../utils/agentExpertise';
import {
  detachAgentKnowledgeMountsForRecipient,
  rehomeRetainedAgentKnowledgeMounts,
} from '../../utils/agentKnowledgeMounts';
import { rehomeAgentLabelsForRecipient } from '../../utils/agentLabelsOwnership';
import { rehomeAgentQuotaBindingsForRecipient } from '../../utils/agentQuotaBindings';
import { resolveGroupMembershipType } from '../../utils/groupMembership';
import type { AgentGroupScope } from './scope';

/**
 * Same-workspace ownership handover: what accepting a member-to-member
 * transfer request executes. Deliberately narrower than the cross-scope
 * `AgentGroupRepository.transferToWorkspace` — the group stays where it is,
 * so nothing is cloned and no conversation moves. Only ownership flips: the
 * group row, its junction rows, and the member agents that exist to serve it
 * (supervisor + generated members). Referenced standalone members keep their
 * own owners — membership never owned them.
 *
 * Runs inside the caller's transaction: the caller flips the transfer
 * request's status in the same `trx`, so a stale/raced accept rolls both
 * back together. It writes the group, its member agents and their tasks,
 * project links and runtime rows, so it is a repository unit of work rather
 * than a `ChatGroupModel` method.
 */
export const transferGroupOwnership = async (
  ctx: Pick<AgentGroupScope, 'workspaceId'>,
  trx: Transaction,
  params: {
    /** The owner recorded on the transfer request; a mismatch means the request is stale. */
    fromUserId: string;
    groupId: string;
    toUserId: string;
  },
): Promise<void> => {
  const { fromUserId, groupId, toUserId } = params;
  if (!ctx.workspaceId) throw new Error(CHAT_GROUP_OWNERSHIP_STALE);

  // FOR UPDATE: serialize against a concurrent cross-scope transfer, delete,
  // or second accept; the loser re-reads and fails the staleness check.
  const [group] = await trx
    .select()
    .from(chatGroups)
    .where(and(eq(chatGroups.id, groupId), eq(chatGroups.workspaceId, ctx.workspaceId)))
    .for('update');
  if (!group || group.userId !== fromUserId) throw new Error(CHAT_GROUP_OWNERSHIP_STALE);

  // Raw roster read (no visibility predicate): the owned/referenced split
  // must see every member, exactly as delete and the cross-scope transfer do.
  const memberRows = await trx
    .select({
      agentId: chatGroupsAgents.agentId,
      role: chatGroupsAgents.role,
      slug: agents.slug,
      virtual: agents.virtual,
    })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(chatGroupsAgents.agentId, agents.id))
    .where(eq(chatGroupsAgents.chatGroupId, groupId));

  const agentIds = memberRows.map((row) => row.agentId);
  const ownedAgentIds = memberRows
    .filter((row) => resolveGroupMembershipType(row) === 'owned')
    .map((row) => row.agentId);

  // Same lock-then-guard as `transferToWorkspace`: serialize with a
  // concurrent transfer of any member agent BEFORE consulting the pending
  // job tables, so two racing operations cannot both pass the guards.
  if (agentIds.length > 0) {
    await trx
      .select({ id: agents.id })
      .from(agents)
      .where(inArray(agents.id, agentIds))
      .orderBy(asc(agents.id))
      .for('update');
  }

  // A share row keeps the agent bound to its current owner and workspace,
  // including when the share is paused. Check only owned members: referenced
  // standalone agents remain with their owner and do not move with the group.
  if (ownedAgentIds.length > 0) {
    const [existingShare] = await trx
      .select({ id: agentShares.id })
      .from(agentShares)
      .where(inArray(agentShares.agentId, ownedAgentIds))
      .limit(1);
    if (existingShare) throw new Error(AGENT_SHARED_TRANSFER_BLOCKED);
  }

  // A REFERENCED member that is private to someone other than the recipient
  // would silently vanish from the roster for the group's new owner (every
  // roster read applies member-agent visibility). Refuse instead — same
  // policy as the cross-scope transfer; the member's owner can share it and
  // the recipient can retry. Evaluated from a re-read AFTER the agent locks
  // above, so a visibility flip racing this handover cannot slip past the
  // guard on a stale snapshot.
  const referencedIds = memberRows
    .filter((row) => resolveGroupMembershipType(row) === 'referenced')
    .map((row) => row.agentId);
  if (referencedIds.length > 0) {
    const lockedReferenced = await trx
      .select({ userId: agents.userId, visibility: agents.visibility })
      .from(agents)
      .where(inArray(agents.id, referencedIds));
    const hasHiddenReferencedMember = lockedReferenced.some(
      (row) => row.visibility === 'private' && row.userId !== toUserId,
    );
    if (hasHiddenReferencedMember) throw new Error(CHAT_GROUP_TRANSFER_HIDDEN_MEMBER);
  }

  // An unfinished backfill still rewrites rows toward the OLD owner's
  // request; hand the group over only once it has drained.
  if (
    (await AgentTransferJobModel.hasPendingJobForAgents(trx, agentIds)) ||
    (await AgentTransferJobModel.hasPendingJobForGroups(trx, [groupId]))
  ) {
    throw new Error(AGENT_TRANSFER_IN_PROGRESS);
  }
  if (
    (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, agentIds)) ||
    (await AgentCopyJobModel.hasPendingCopyJobForSourceGroups(trx, [groupId]))
  ) {
    throw new Error(AGENT_COPY_IN_PROGRESS);
  }

  // An ownership flip does not make the group's content newer, and the
  // scope/visibility/folder/pin all stay: the group is not moving anywhere.
  // `clientId` is cleared — unique per (clientId, userId), it belongs to the
  // previous owner's client-side sync and would abort the accept if the
  // recipient already owns a group with the same value.
  await trx
    .update(chatGroups)
    .set({ clientId: null, updatedAt: chatGroups.updatedAt, userId: toUserId })
    .where(eq(chatGroups.id, groupId));

  // The junction rows belong to the GROUP, so all of them follow its owner —
  // including the rows pointing at referenced members that stay put.
  await trx
    .update(chatGroupsAgents)
    .set({ userId: toUserId })
    .where(eq(chatGroupsAgents.chatGroupId, groupId));

  if (ownedAgentIds.length > 0) {
    // Re-home device bindings on the owned agents (supervisor + generated
    // members): a boundDeviceId / fixed device policy pointing at the
    // previous owner's personal or private device would leave the
    // recipient's group runs unroutable. Same sanitation as the member
    // agent handover.
    const ownedRows = await trx
      .select({ agencyConfig: agents.agencyConfig, id: agents.id, visibility: agents.visibility })
      .from(agents)
      .where(inArray(agents.id, ownedAgentIds));
    const cleanedConfigs = await sanitizeAgencyConfigsForWorkspace(
      trx,
      ctx.workspaceId,
      ownedRows.map((row) => row.agencyConfig),
      { viewerUserId: toUserId },
    );
    for (const [index, row] of ownedRows.entries()) {
      // `clientId` cleared for the same reason as the single-agent handover:
      // it is unique per (clientId, userId) and belongs to the previous
      // owner's client-side sync.
      await trx
        .update(agents)
        .set({
          agencyConfig: cleanedConfigs[index],
          clientId: null,
          updatedAt: agents.updatedAt,
          userId: toUserId,
        })
        .where(eq(agents.id, row.id));
    }

    // Owner-attributed runtime rows (cron jobs, bot providers) execute AS
    // their `userId`; the previous owner's rows on the owned agents re-home
    // with them — DISABLED, so nothing runs silently under the recipient's
    // identity and budget. Same policy as the single-agent handover.
    await trx
      .update(agentCronJobs)
      .set({ enabled: false, updatedAt: agentCronJobs.updatedAt, userId: toUserId })
      .where(
        and(inArray(agentCronJobs.agentId, ownedAgentIds), eq(agentCronJobs.userId, fromUserId)),
      );
    await trx
      .update(agentBotProviders)
      .set({ enabled: false, updatedAt: agentBotProviders.updatedAt, userId: toUserId })
      .where(
        and(
          inArray(agentBotProviders.agentId, ownedAgentIds),
          eq(agentBotProviders.userId, fromUserId),
        ),
      );
    // Quota account bindings (and exclusively-consumed provider accounts)
    // re-home: both cascade on user deletion. See the util.
    await rehomeAgentQuotaBindingsForRecipient(trx, {
      agentIds: ownedAgentIds,
      fromUserId,
      recipientId: toUserId,
    });

    // Label assignments (and exclusively-assigned backing labels) re-home:
    // both cascade on user deletion. See the util.
    await rehomeAgentLabelsForRecipient(trx, {
      agentIds: ownedAgentIds,
      fromUserId,
      recipientId: toUserId,
    });

    // Tasks stay with their creators (moving ownership breaks in-flight run
    // identity and splits subtrees). But owned agents that are PRIVATE stop
    // resolving for everyone but the recipient, so detach other users' task
    // assignments to them — the schedule goes quiet rather than erroring.
    const privateOwnedIds = ownedRows
      .filter((row) => row.visibility === 'private')
      .map((row) => row.id);
    if (privateOwnedIds.length > 0) {
      await trx
        .update(tasks)
        .set({ assigneeAgentId: null, updatedAt: tasks.updatedAt })
        .where(
          and(inArray(tasks.assigneeAgentId, privateOwnedIds), ne(tasks.createdByUserId, toUserId)),
        );

      // Private owned agents also leave other members' PROJECTS explicitly —
      // project agent listings apply member-agent visibility, so those
      // projects would otherwise keep a silent hole. Same policy as the
      // single-agent handover.
      const projectLinks = await trx
        .select({ linkId: projectAgents.id, projectOwnerId: projects.userId })
        .from(projectAgents)
        .innerJoin(projects, eq(projectAgents.projectId, projects.id))
        .where(inArray(projectAgents.agentId, privateOwnedIds));
      const leavingProjectLinkIds = projectLinks
        .filter((link) => link.projectOwnerId !== toUserId)
        .map((link) => link.linkId);
      if (leavingProjectLinkIds.length > 0) {
        await trx.delete(projectAgents).where(inArray(projectAgents.id, leavingProjectLinkIds));
      }
    }

    // Knowledge mounts on the owned agents whose KB / file the recipient
    // cannot access would survive as dead links the runtime silently skips.
    // Detach them — same policy as the single-agent handover; the manifest
    // surfaces the count to both parties before acceptance.
    await detachAgentKnowledgeMountsForRecipient(trx, {
      agentIds: ownedAgentIds,
      recipientId: toUserId,
      workspaceId: ctx.workspaceId,
    });
    // The retained mounts the previous owner created re-home with the owned
    // agents — the junction `user_id` cascades on user deletion, and the
    // group's knowledge must not die with the previous owner's account.
    await rehomeRetainedAgentKnowledgeMounts(trx, {
      agentIds: ownedAgentIds,
      fromUserId,
      recipientId: toUserId,
      workspaceId: ctx.workspaceId,
    });

    // Connectors: OAuth credentials are personal identity and never travel.
    // Agent-owned rows on the owned members re-home as disconnected shells
    // the recipient must reauthorize; other members' mounted rows unmount.
    await rehomeAgentConnectorsForRecipient(trx, {
      agentIds: ownedAgentIds,
      recipientId: toUserId,
    });

    // Expertise + VFS documents: same policies as the single-agent handover
    // (agent-exclusive domains re-home / shared ones unbind; the previous
    // owner's document rows re-home so account deletion cannot strip them).
    await rehomeAgentExpertiseForRecipient(trx, {
      agentIds: ownedAgentIds,
      recipientId: toUserId,
      workspaceId: ctx.workspaceId,
    });
    await rehomeAgentDocumentsForRecipient(trx, {
      agentIds: ownedAgentIds,
      fromUserId,
      recipientId: toUserId,
      workspaceId: ctx.workspaceId,
    });
  }
};
