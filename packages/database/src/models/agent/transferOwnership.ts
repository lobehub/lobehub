import { and, eq, inArray, ne } from 'drizzle-orm';

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
import { rehomeAgentConnectorsForRecipient } from '../../utils/agentConnectors';
import { rehomeAgentDocumentsForRecipient } from '../../utils/agentDocumentsOwnership';
import { rehomeAgentExpertiseForRecipient } from '../../utils/agentExpertise';
import {
  detachAgentKnowledgeMountsForRecipient,
  rehomeRetainedAgentKnowledgeMounts,
} from '../../utils/agentKnowledgeMounts';
import { rehomeAgentLabelsForRecipient } from '../../utils/agentLabelsOwnership';
import { rehomeAgentQuotaBindingsForRecipient } from '../../utils/agentQuotaBindings';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../agentTransferJob';
import { type AgentModelContext } from './context';
import {
  AGENT_OWNERSHIP_STALE,
  AGENT_SHARED_TRANSFER_BLOCKED,
  AgentOwnedByGroupError,
} from './errors';
import { findOwnedGroupMemberships } from './groupMembership';

/**
 * Same-workspace ownership handover: the recipient of an accepted transfer
 * request becomes the agent's owner. Deliberately NOT {@link transferAgents}:
 * the agent stays in its workspace, so nothing about scope changes — slug,
 * visibility, permission rows, group links, labels and every member's
 * conversations all stay put — conversation history never changes author on
 * a member handover.
 *
 * Runs inside the caller's transaction: the caller flips the transfer
 * request's status in the same `trx`, so a stale/raced accept rolls both
 * back together.
 */
export const transferAgentOwnership = async (
  ctx: AgentModelContext,
  trx: Transaction,
  params: {
    agentId: string;
    /** The owner recorded on the transfer request; a mismatch means the request is stale. */
    fromUserId: string;
    toUserId: string;
  },
): Promise<void> => {
  const { agentId, fromUserId, toUserId } = params;
  if (!ctx.workspaceId) throw new Error(AGENT_OWNERSHIP_STALE);

  // FOR UPDATE: serialize against a concurrent cross-scope transfer or a
  // second accept; the loser re-reads and fails the staleness check below.
  const [agent] = await trx
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, ctx.workspaceId)))
    .for('update');
  if (!agent || agent.userId !== fromUserId) throw new Error(AGENT_OWNERSHIP_STALE);

  // An unfinished backfill still rewrites rows toward the OLD owner's
  // request; hand the agent over only once it has drained (same guards as
  // the cross-scope transfer).
  if (await AgentTransferJobModel.hasPendingJobForAgents(trx, [agentId])) {
    throw new Error(AGENT_TRANSFER_IN_PROGRESS);
  }
  if (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, [agentId])) {
    throw new Error(AGENT_COPY_IN_PROGRESS);
  }

  // Mirror of cross-scope guard 1c: an agent with an OWNED group membership
  // (virtual member, or a supervisor) has no life apart from its group —
  // handing it to another member would leave the group broken or headless.
  const ownedGroups = await findOwnedGroupMemberships(ctx, trx, [agentId]);
  if (ownedGroups.length > 0) throw new AgentOwnedByGroupError(ownedGroups);

  /** Reject before mutation so the transfer request and share remain unchanged. */
  const [existingShare] = await trx
    .select({ id: agentShares.id })
    .from(agentShares)
    .where(eq(agentShares.agentId, agentId))
    .limit(1);
  if (existingShare) throw new Error(AGENT_SHARED_TRANSFER_BLOCKED);

  // A PRIVATE agent stops resolving for everyone but the recipient. Groups
  // that reference it and are NOT the recipient's would render a silent hole
  // in their roster; leave those groups explicitly instead (the manifest
  // surfaces the count to both parties before commit).
  if (agent.visibility === 'private') {
    const groupLinks = await trx
      .select({ groupId: chatGroupsAgents.chatGroupId, groupOwnerId: chatGroups.userId })
      .from(chatGroupsAgents)
      .innerJoin(chatGroups, eq(chatGroupsAgents.chatGroupId, chatGroups.id))
      .where(eq(chatGroupsAgents.agentId, agentId));
    const leavingGroupIds = groupLinks
      .filter((link) => link.groupOwnerId !== toUserId)
      .map((link) => link.groupId);
    if (leavingGroupIds.length > 0) {
      await trx
        .delete(chatGroupsAgents)
        .where(
          and(
            eq(chatGroupsAgents.agentId, agentId),
            inArray(chatGroupsAgents.chatGroupId, leavingGroupIds),
          ),
        );
    }

    // Same policy for PROJECTS that attached this private agent: project
    // agent listings apply member-agent visibility, so other members'
    // projects would keep a silent hole. Leave them explicitly; the
    // manifest surfaces the count to both parties.
    const projectLinks = await trx
      .select({ linkId: projectAgents.id, projectOwnerId: projects.userId })
      .from(projectAgents)
      .innerJoin(projects, eq(projectAgents.projectId, projects.id))
      .where(eq(projectAgents.agentId, agentId));
    const leavingProjectLinkIds = projectLinks
      .filter((link) => link.projectOwnerId !== toUserId)
      .map((link) => link.linkId);
    if (leavingProjectLinkIds.length > 0) {
      await trx.delete(projectAgents).where(inArray(projectAgents.id, leavingProjectLinkIds));
    }
  }

  // Re-home device bindings: a boundDeviceId / workingDirByDevice entry (or
  // a fixed device policy) pointing at the previous owner's personal device
  // would leave the recipient's runs unroutable. Same sanitation as moving
  // an agent into a workspace.
  const [cleanedAgencyConfig] = await ctx.sanitizeAgencyConfigForWorkspace(
    trx,
    ctx.workspaceId,
    [agent.agencyConfig],
    // The recipient is the new author: bindings to another member's PRIVATE
    // workspace device are as unreachable for them as a personal device.
    { viewerUserId: toUserId },
  );

  // An ownership flip does not make the agent's content newer. `clientId`
  // is cleared: it identifies the row to the CREATOR's client-side sync and
  // is unique per (clientId, userId) — if the recipient already owns an
  // agent with the same value, keeping it would abort every accept attempt.
  await trx
    .update(agents)
    .set({
      agencyConfig: cleanedAgencyConfig,
      clientId: null,
      updatedAt: agents.updatedAt,
      userId: toUserId,
    })
    .where(eq(agents.id, agentId));

  // Owner-attributed runtime rows travel with the agent: cron jobs and bot
  // providers execute AS their `userId`, so rows the previous owner set up
  // must re-home or the transferred bot keeps running as the former member
  // (and dies with their account). They arrive DISABLED — nothing may run
  // silently under the recipient's identity and budget; re-enabling in the
  // agent's settings is their explicit consent. Only the previous owner's
  // rows move — teammates' schedules stay theirs, untouched.
  await trx
    .update(agentCronJobs)
    .set({ enabled: false, updatedAt: agentCronJobs.updatedAt, userId: toUserId })
    .where(and(eq(agentCronJobs.agentId, agentId), eq(agentCronJobs.userId, fromUserId)));
  await trx
    .update(agentBotProviders)
    .set({ enabled: false, updatedAt: agentBotProviders.updatedAt, userId: toUserId })
    .where(and(eq(agentBotProviders.agentId, agentId), eq(agentBotProviders.userId, fromUserId)));
  // Quota account bindings (and exclusively-consumed provider accounts)
  // re-home: both cascade on user deletion. See the util.
  await rehomeAgentQuotaBindingsForRecipient(trx, {
    agentIds: [agentId],
    fromUserId,
    recipientId: toUserId,
  });

  // Label assignments (and exclusively-assigned backing labels) re-home:
  // both cascade on user deletion. See the util.
  await rehomeAgentLabelsForRecipient(trx, {
    agentIds: [agentId],
    fromUserId,
    recipientId: toUserId,
  });

  // Tasks stay with their creators — moving `createdByUserId` would break
  // in-flight run identity and split task subtrees across owners. What DOES
  // change: a PRIVATE agent stops resolving for everyone but the recipient,
  // so tasks other users had assigned to it would fail every scheduled run
  // with NOT_FOUND. Detach those assignments instead — the schedule goes
  // quiet (visible in the task list) rather than erroring; a public agent's
  // tasks keep working and are left untouched.
  if (agent.visibility === 'private') {
    await trx
      .update(tasks)
      .set({ assigneeAgentId: null, updatedAt: tasks.updatedAt })
      .where(and(eq(tasks.assigneeAgentId, agentId), ne(tasks.createdByUserId, toUserId)));
  }

  // Knowledge mounts whose KB / file the recipient cannot access (private to
  // another member) would survive as dead links: the knowledge runtime
  // silently filters them out and the agent stops using that knowledge with
  // no visible cause. Detach them instead — the manifest surfaces the count
  // to both parties before acceptance.
  await detachAgentKnowledgeMountsForRecipient(trx, {
    agentIds: [agentId],
    recipientId: toUserId,
    workspaceId: ctx.workspaceId,
  });
  // The retained mounts the previous owner created re-home to the recipient:
  // the junction `user_id` cascades on user deletion, and knowledge wired to
  // the agent must not die with the previous owner's account.
  await rehomeRetainedAgentKnowledgeMounts(trx, {
    agentIds: [agentId],
    fromUserId,
    recipientId: toUserId,
    workspaceId: ctx.workspaceId,
  });

  // Connectors: OAuth credentials are personal identity and never travel.
  // Agent-owned rows re-home as disconnected shells the recipient must
  // reauthorize; other members' mounted rows unmount. See the util.
  await rehomeAgentConnectorsForRecipient(trx, {
    agentIds: [agentId],
    recipientId: toUserId,
  });

  // Expertise: the agent's learned domains resolve through the viewer's
  // visibility filter — agent-exclusive private domains re-home, shared
  // ones unbind explicitly. See the util.
  await rehomeAgentExpertiseForRecipient(trx, {
    agentIds: [agentId],
    recipientId: toUserId,
    workspaceId: ctx.workspaceId,
  });

  // VFS documents / skills: dedicated files re-home with the agent (their
  // user_id cascades on user deletion); ASSOCIATED personal documents never
  // change owner — invisible-to-recipient bindings detach explicitly.
  await rehomeAgentDocumentsForRecipient(trx, {
    agentIds: [agentId],
    fromUserId,
    recipientId: toUserId,
    workspaceId: ctx.workspaceId,
  });
};
