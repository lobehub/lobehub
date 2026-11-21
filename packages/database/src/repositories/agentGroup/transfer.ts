import { and, asc, count, eq, inArray, ne, or } from 'drizzle-orm';

import { AGENT_SHARED_TRANSFER_BLOCKED } from '../../models/agent';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../models/agentCopyJob';
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
import type { AgentItem } from '../../schemas';
import {
  agentLabelAssignments,
  agents,
  agentShares,
  chatGroups,
  chatGroupsAgents,
  messages,
  threads,
  topics,
} from '../../schemas';
import { resolveGroupMembershipType } from '../../utils/groupMembership';
import { GROUP_HAS_INACCESSIBLE_MEMBER } from './constants';
import type { AgentGroupScope } from './scope';
import { buildCopiedAgent } from './utils';

/**
 * Whether the group's transfer cascade (member agents + group topics /
 * threads / messages) contains rows created by someone else. Transfers
 * rehome every cascaded row, so non-owner members must not move a group
 * that carries teammates' agents or conversations.
 */
export const groupTransferHasForeignRows = async (
  scope: AgentGroupScope,
  groupId: string,
): Promise<boolean> => {
  const agentLinks = await scope.db
    .select({ agentId: chatGroupsAgents.agentId })
    .from(chatGroupsAgents)
    .where(eq(chatGroupsAgents.chatGroupId, groupId));
  const agentIds = agentLinks.map((link) => link.agentId);

  if (agentIds.length > 0) {
    const [foreignAgent] = await scope.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(inArray(agents.id, agentIds), ne(agents.userId, scope.userId)))
      .limit(1);
    if (foreignAgent) return true;
  }

  const [foreignTopic] = await scope.db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.groupId, groupId), ne(topics.userId, scope.userId)))
    .limit(1);
  if (foreignTopic) return true;

  // Comments move (or die, when the target is personal scope) with their
  // topics — a teammate's comment on the caller's own topic is still their
  // work. NULL authors (deleted accounts) count as foreign too.
  if (await hasForeignTopicComments(scope.db, scope.userId, eq(topics.groupId, groupId)))
    return true;

  const [foreignThread] = await scope.db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.groupId, groupId), ne(threads.userId, scope.userId)))
    .limit(1);
  if (foreignThread) return true;

  const [foreignMessage] = await scope.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.groupId, groupId), ne(messages.userId, scope.userId)))
    .limit(1);
  return !!foreignMessage;
};

export const transferGroupToWorkspace = async (
  scope: AgentGroupScope,
  groupId: string,
  targetWorkspaceId: string | null,
  targetUserId: string,
  targetVisibility?: 'private' | 'public',
  options: { rejectForeignTopicCommentAuthors?: boolean } = {},
): Promise<{ groupId: string; transferJobId: string | null } | null> => {
  const sourceGroup = await scope.db.query.chatGroups.findFirst({
    where: and(eq(chatGroups.id, groupId), scope.groupOwnership()),
  });

  if (!sourceGroup) return null;

  return scope.db.transaction(async (trx) => {
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
      .where(and(eq(chatGroups.id, groupId), scope.groupOwnership()))
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
            scope.agentOwnership(),
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
            ...buildCopiedAgent(
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
      (await hasForeignTopicComments(trx, scope.userId, eq(topics.groupId, groupId)))
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
      await trx.update(threads).set(ownershipUpdate).where(inArray(threads.topicId, movedTopicIds));
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
          .where(and(inArray(threads.topicId, movedTopicIds), eq(threads.agentId, sourceAgentId)));
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
        source: { userId: scope.userId, workspaceId: scope.workspaceId ?? null },
        target: targetScope,
        topics: movedTopics.map((topic) => ({
          activityAt: activityAtByTopic.get(topic.id) ?? topic.updatedAt,
          id: topic.id,
        })),
      });
    }

    return { groupId, transferJobId };
  });
};
