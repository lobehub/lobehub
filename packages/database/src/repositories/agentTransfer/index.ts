import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { and, asc, count, eq, inArray, isNull, like, notInArray, or } from 'drizzle-orm';

import { type AgentModelContext, createAgentModelContext } from '../../models/agent/context';
import { AGENT_SHARED_TRANSFER_BLOCKED, AgentOwnedByGroupError } from '../../models/agent/errors';
import { findOwnedGroupMemberships } from '../../models/agent/groupMembership';
import { type AgentTransferOptions } from '../../models/agent/types';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../models/agentCopyJob';
import {
  AGENT_TRANSFER_IN_PROGRESS,
  AgentTransferJobModel,
  getAgentTransferSyncMessageThreshold,
  rewriteMessageScopeForTopics,
  rewriteResidualMessageScope,
} from '../../models/agentTransferJob';
import {
  hasForeignTopicComments,
  syncTopicCommentsOnTopicTransfer,
  TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS,
} from '../../models/topicComment';
import {
  agentBotProviders,
  agentCronJobs,
  agentLabelAssignments,
  agents,
  agentsFiles,
  agentShares,
  agentsKnowledgeBases,
  agentsToSessions,
  briefs,
  chatGroupsAgents,
  expertiseBindings,
  expertiseDomains,
  expertiseInsights,
  expertiseRuns,
  messages,
  sessions,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
  taskTopics,
  threads,
  topicDocuments,
  topics,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { rehomeAgentConnectorsForScopeTransfer } from '../../utils/agentConnectors';
import { moveAgentDocumentsForScopeTransfer } from '../../utils/agentDocumentsOwnership';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Batch variant of {@link transferAgent}: moves several agents (and their
 * cascaded topics / messages / threads / tasks / …) in ONE transaction, with
 * every large-table UPDATE issued once via `inArray` instead of once per
 * agent. All-or-nothing: a failure on any agent rolls back the whole batch.
 */
const transferAgents = async (
  ctx: AgentModelContext,
  agentIds: string[],
  targetWorkspaceId: string | null,
  targetUserId: string,
  targetVisibility?: 'private' | 'public',
  options: AgentTransferOptions = {},
): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }[]> => {
  if (agentIds.length === 0) return [];

  return ctx.db.transaction(async (trx) => {
    // 1. Verify all agents exist and belong to current scope. FOR UPDATE so
    // two concurrent transfers of the same agent serialize HERE, before the
    // pending-job guard below: the loser re-reads after the winner commits
    // and either no longer finds the agent in its scope, or sees the
    // winner's freshly inserted job. Without the lock both would pass the
    // guard first (check-then-act) and enqueue duplicate jobs.
    const foundAgents = await trx
      .select()
      .from(agents)
      .where(and(inArray(agents.id, agentIds), ctx.ownership()))
      .for('update');
    if (foundAgents.length !== new Set(agentIds).size) throw new Error('Agent not found');
    const agentById = new Map(foundAgents.map((agent) => [agent.id, agent]));

    // 1a. An unfinished backfill still owns these agents' message rewrite —
    // a second transfer would race it (and re-enqueue topics the first job
    // is still draining). Runs under the row locks above, so the check is
    // race-free against a concurrent transfer's own job insert.
    if (await AgentTransferJobModel.hasPendingJobForAgents(trx, agentIds)) {
      throw new Error(AGENT_TRANSFER_IN_PROGRESS);
    }

    // 1b. A pending copy job reads from these agents' topics by id — moving
    // them to another scope would make it drain empty topics. Copy jobs
    // register only their TARGET agents in the junction, so the source side
    // needs its own payload-based guard.
    if (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, agentIds)) {
      throw new Error(AGENT_COPY_IN_PROGRESS);
    }

    // 1c. A group-owned agent has no existence apart from its group: the
    // synthetic supervisor, and members built through the group builder.
    // Step 14 below drops every chat-group link the moved agents hold, which
    // for an owned member means the group silently loses it — and for a
    // supervisor means the group is left headless, at which point
    // `findByIdWithAgents` quietly mints a blank replacement and the
    // configured systemRole/model are gone for good.
    //
    // Refuse instead, naming the groups so the caller can act. Nothing in the
    // product can reach this: owned implies `virtual`, and `queryAgents`
    // filters virtual agents out of every transfer surface. It is a guard
    // against a caller that reaches the model directly.
    const ownedGroups = await findOwnedGroupMemberships(ctx, trx, agentIds);
    if (ownedGroups.length > 0) throw new AgentOwnedByGroupError(ownedGroups);

    // 1d. Keep the share owner and tenancy stable. Check paused shares too:
    // disabling a link retains its grants and visitor history. The Agent row
    // lock also serializes this guard with AgentShareModel.create.
    const [existingShare] = await trx
      .select({ id: agentShares.id })
      .from(agentShares)
      .where(inArray(agentShares.agentId, agentIds))
      .limit(1);
    if (existingShare) throw new Error(AGENT_SHARED_TRANSFER_BLOCKED);

    // 2. Resolve slug conflicts in the target scope with a single query:
    //    fetch every existing slug that could collide (exact match or
    //    `<slug>-<n>` suffix), then pick free suffixes in memory. Agents
    //    inside the batch also compete with each other for the same slug.
    const targetScopeWhere = targetWorkspaceId
      ? eq(agents.workspaceId, targetWorkspaceId)
      : and(eq(agents.userId, targetUserId), isNull(agents.workspaceId));
    const sluggedAgents = foundAgents.filter((agent) => agent.slug);
    const resolvedSlugs = new Map<string, string | null>();
    if (sluggedAgents.length > 0) {
      const conflictRows = await trx
        .select({ slug: agents.slug })
        .from(agents)
        .where(
          and(
            targetScopeWhere,
            notInArray(agents.id, agentIds),
            or(
              ...sluggedAgents.map((agent) =>
                or(eq(agents.slug, agent.slug!), like(agents.slug, `${agent.slug}-%`)),
              ),
            ),
          ),
        );
      const taken = new Set(conflictRows.map((row) => row.slug));
      for (const agent of sluggedAgents) {
        let slug = agent.slug!;
        if (taken.has(slug)) {
          let suffix = 1;
          while (suffix < 100) {
            const candidate = `${slug}-${suffix}`;
            if (!taken.has(candidate)) {
              slug = candidate;
              break;
            }
            suffix++;
          }
        }
        taken.add(slug);
        resolvedSlugs.set(agent.id, slug);
      }
    }

    // 3. Build ownership update payload
    const ownershipUpdate = {
      userId: targetUserId,
      workspaceId: targetWorkspaceId,
    };

    // 3a. Strip stale device bindings when moving INTO a workspace: any
    // boundDeviceId / workingDirByDevice entry that isn't enrolled in the
    // target workspace is silently dropped. Otherwise the moved agent would
    // reference a device only the previous owner can reach. Moving to a
    // personal scope (`targetWorkspaceId === null`) keeps existing bindings.
    // Device rows for the whole batch are fetched with one query.
    const resolvedAgencyConfigs = new Map<string, LobeAgentAgencyConfig | null>();
    if (targetWorkspaceId) {
      const cleanedConfigs = await ctx.sanitizeAgencyConfigForWorkspace(
        trx,
        targetWorkspaceId,
        foundAgents.map((agent) => agent.agencyConfig),
      );
      foundAgents.forEach((agent, index) =>
        resolvedAgencyConfigs.set(agent.id, cleanedConfigs[index]),
      );
    }

    // 4. Update the agent records. slug / agencyConfig differ per agent, so
    //    these are per-row PK updates (cheap); the large cascaded tables
    //    below are still one bulk UPDATE each.
    //    Only apply visibility when moving into a workspace — visibility is
    //    a no-op in personal scope where every row is implicitly private.
    //    `sessionGroupId` is cleared because sidebar folders belong to the
    //    source scope (same rationale as dropping chatGroupsAgents below);
    //    a stale reference would orphan the agent out of the target sidebar.
    const visibilityUpdate =
      targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};
    for (const agent of foundAgents) {
      await trx
        .update(agents)
        .set({
          ...ownershipUpdate,
          ...visibilityUpdate,
          agencyConfig: targetWorkspaceId
            ? (resolvedAgencyConfigs.get(agent.id) ?? null)
            : (agent.agencyConfig ?? null),
          // Pins are shared state now, exactly like the folder above: a pin
          // the previous owner set for themselves would arrive as a pin for
          // every member of the target workspace. Both belong to the source
          // scope and are dropped with it.
          pinned: false,
          sessionGroupId: null,
          slug: resolvedSlugs.get(agent.id) ?? agent.slug,
          // A scope transfer does not make the agent's content newer. Keep the
          // original recency so home/search ordering is not reshuffled.
          updatedAt: agents.updatedAt,
        })
        .where(eq(agents.id, agent.id));
    }

    // 5. Update sessions linked via agentsToSessions
    const links = await trx
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(inArray(agentsToSessions.agentId, agentIds));

    const sessionIds = [...new Set(links.map((l) => l.sessionId))];

    if (sessionIds.length > 0) {
      // `groupId` is cleared for the same reason as the agent's
      // `sessionGroupId`: folders stay in the source scope.
      await trx
        .update(sessions)
        .set({ ...ownershipUpdate, groupId: null, updatedAt: sessions.updatedAt })
        .where(inArray(sessions.id, sessionIds));
    }

    await trx
      .update(agentsToSessions)
      .set(ownershipUpdate)
      .where(inArray(agentsToSessions.agentId, agentIds));

    // 5b. Drop label assignments. Unlike sessions, these cannot travel: a
    // label belongs to the source registry, and the target scope has its own
    // (or none). Re-homing them would need a name-matched label in the
    // target, which is a merge decision, not a transfer one. Leaving them
    // instead would keep inflating the source label's usage count and make
    // the labels reappear if the agent ever moves back — same reasoning as
    // the device bindings stripped above.
    await trx.delete(agentLabelAssignments).where(inArray(agentLabelAssignments.agentId, agentIds));

    // 6. Update topics (linked via sessionId or agentId)
    const topicCondition =
      sessionIds.length > 0
        ? or(inArray(topics.sessionId, sessionIds), inArray(topics.agentId, agentIds))
        : inArray(topics.agentId, agentIds);

    // Create locks the topic before inserting a comment. Lock every topic in
    // the same order before the authoritative transfer authorization check,
    // so either the create becomes visible here or it observes the moved
    // scope and fails after this transaction commits.
    await trx
      .select({ id: topics.id })
      .from(topics)
      .where(topicCondition!)
      .orderBy(asc(topics.id))
      .for('update');

    if (
      options.rejectForeignTopicCommentAuthors &&
      (await hasForeignTopicComments(trx, ctx.userId, topicCondition!))
    ) {
      throw new Error(TOPIC_COMMENT_TRANSFER_HAS_FOREIGN_AUTHORS);
    }
    const movedTopics = await trx
      .update(topics)
      .set({ ...ownershipUpdate, updatedAt: topics.updatedAt })
      .where(topicCondition!)
      .returning({ id: topics.id, updatedAt: topics.updatedAt });
    const movedTopicIds = movedTopics.map((topic) => topic.id);

    // 6a. Topic comments denormalize the topic's workspaceId — move them
    // with the topic (or drop them when leaving workspace scope entirely),
    // otherwise workspace-filtered comment reads go stale. See the helper doc.
    await syncTopicCommentsOnTopicTransfer(trx, movedTopicIds, targetWorkspaceId);

    // 7. Message scope rewrite — fast/slow split. Rewriting a message row
    // maintains every message index (incl. the multi-GB BM25 index), so a
    // heavy agent's history cannot be rewritten inside this transaction:
    // above the threshold the rewrite is recorded as an async backfill job
    // (drained topic-by-topic; see AgentTransferJobModel) and the rows keep
    // their source-scope snapshot until the job reaches them.
    //
    // Both paths anchor on the moved topics (plus a topicless residual by
    // session/agent linkage) rather than the legacy session/agent-only
    // condition, so topic-only rows (OpenAPI create shape) and the message
    // child tables move too instead of stranding in the source scope.
    const messageCondition =
      sessionIds.length > 0
        ? or(inArray(messages.sessionId, sessionIds), inArray(messages.agentId, agentIds))
        : inArray(messages.agentId, agentIds);
    const [{ affectedMessages }] = await trx
      .select({ affectedMessages: count() })
      .from(messages)
      .where(
        movedTopicIds.length > 0
          ? or(inArray(messages.topicId, movedTopicIds), messageCondition!)
          : messageCondition!,
      );

    const targetScope = { userId: targetUserId, workspaceId: targetWorkspaceId };
    let transferJobId: string | null = null;
    if (affectedMessages <= getAgentTransferSyncMessageThreshold()) {
      await rewriteMessageScopeForTopics(trx, movedTopicIds, targetScope);
      await rewriteResidualMessageScope(trx, { agentIds, sessionIds }, targetScope);
    } else {
      transferJobId = await AgentTransferJobModel.createJob(trx, {
        agentIds,
        sessionIds,
        source: { userId: ctx.userId, workspaceId: ctx.workspaceId ?? null },
        target: targetScope,
        topics: movedTopics.map((topic) => ({ activityAt: topic.updatedAt, id: topic.id })),
      });
    }

    // 8. Update threads (linked via agentId)
    await trx
      .update(threads)
      .set({ ...ownershipUpdate, updatedAt: threads.updatedAt })
      .where(inArray(threads.agentId, agentIds));

    // 9. Update agent files associations
    await trx
      .update(agentsFiles)
      .set({ ...ownershipUpdate, updatedAt: agentsFiles.updatedAt })
      .where(inArray(agentsFiles.agentId, agentIds));

    // 10. Update agent knowledge base associations
    await trx
      .update(agentsKnowledgeBases)
      .set({ ...ownershipUpdate, updatedAt: agentsKnowledgeBases.updatedAt })
      .where(inArray(agentsKnowledgeBases.agentId, agentIds));

    // 11. Update agent cron jobs
    await trx
      .update(agentCronJobs)
      .set({ ...ownershipUpdate, updatedAt: agentCronJobs.updatedAt })
      .where(inArray(agentCronJobs.agentId, agentIds));

    // 12. Update tasks assigned to or created by these agents. The scheduled
    // task dispatcher uses `createdByUserId` as the execution owner, so tasks
    // must move with the agent instead of staying under the old owner.
    // Visibility is cascaded to tasks and child rows so a `private` transfer
    // does not leak previously-personal task data to every workspace member:
    // personal rows keep the schema default (`visibility='public'`) but ignore
    // it, whereas workspace rows honor it — without this cascade a `private`
    // transfer would silently downgrade to workspace-public.
    const movedTasks = await trx
      .update(tasks)
      .set({
        createdByUserId: targetUserId,
        updatedAt: tasks.updatedAt,
        workspaceId: targetWorkspaceId,
        ...visibilityUpdate,
      })
      .where(
        or(inArray(tasks.assigneeAgentId, agentIds), inArray(tasks.createdByAgentId, agentIds)),
      )
      .returning({ id: tasks.id });
    const movedTaskIds = movedTasks.map((task) => task.id);

    if (movedTaskIds.length > 0) {
      await trx
        .update(taskDependencies)
        .set({ ...ownershipUpdate, ...visibilityUpdate })
        .where(inArray(taskDependencies.taskId, movedTaskIds));
      await trx
        .update(taskTopics)
        .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: taskTopics.updatedAt })
        .where(inArray(taskTopics.taskId, movedTaskIds));
      await trx
        .update(taskComments)
        .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: taskComments.updatedAt })
        .where(inArray(taskComments.taskId, movedTaskIds));
      await trx.update(briefs).set(ownershipUpdate).where(inArray(briefs.taskId, movedTaskIds));
    }

    await trx.update(briefs).set(ownershipUpdate).where(inArray(briefs.agentId, agentIds));

    // 13. Move expertise owned exclusively by these agents. The domain is
    // the ownership root for lessons, hits and snapshots, so those rows keep
    // their IDs and follow it without per-table rewrites. Runs additionally
    // carry their own scope for attribution and must be re-scoped explicitly.
    // A domain
    // that is also bound to a carrier outside this transfer is shared state
    // and must stay in the source scope; only the moved agent's binding is
    // re-scoped in that case.
    const boundExpertiseDomains = await trx
      .select({ domainId: expertiseBindings.domainId })
      .from(expertiseBindings)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
      .where(
        and(
          inArray(expertiseBindings.agentId, agentIds),
          buildWorkspaceWhere(
            { userId: ctx.userId, workspaceId: ctx.workspaceId },
            expertiseDomains,
          ),
        ),
      );
    const candidateDomainIds = [...new Set(boundExpertiseDomains.map((row) => row.domainId))];

    await trx
      .update(expertiseBindings)
      .set({ workspaceId: targetWorkspaceId, updatedAt: expertiseBindings.updatedAt })
      .where(inArray(expertiseBindings.agentId, agentIds));

    if (candidateDomainIds.length > 0) {
      const bindings = await trx
        .select({
          agentId: expertiseBindings.agentId,
          boundUserId: expertiseBindings.boundUserId,
          boundWorkspaceId: expertiseBindings.boundWorkspaceId,
          domainId: expertiseBindings.domainId,
          projectId: expertiseBindings.projectId,
        })
        .from(expertiseBindings)
        .where(inArray(expertiseBindings.domainId, candidateDomainIds));
      const movedAgentIds = new Set(agentIds);
      const transferableDomainIds = candidateDomainIds.filter((domainId) =>
        bindings
          .filter((binding) => binding.domainId === domainId)
          .every(
            (binding) =>
              binding.agentId !== null &&
              movedAgentIds.has(binding.agentId) &&
              binding.projectId === null &&
              binding.boundWorkspaceId === null &&
              binding.boundUserId === null,
          ),
      );

      if (transferableDomainIds.length > 0) {
        await trx
          .update(expertiseDomains)
          .set({ ...ownershipUpdate, updatedAt: expertiseDomains.updatedAt })
          .where(inArray(expertiseDomains.id, transferableDomainIds));
        await trx
          .update(expertiseInsights)
          .set({ ...ownershipUpdate, updatedAt: expertiseInsights.updatedAt })
          .where(inArray(expertiseInsights.domainId, transferableDomainIds));
        await trx
          .update(expertiseRuns)
          .set({ ...ownershipUpdate, updatedAt: expertiseRuns.updatedAt })
          .where(inArray(expertiseRuns.domainId, transferableDomainIds));
      }
    }

    // 14. Update agent bot providers (transfer, not delete)
    await trx
      .update(agentBotProviders)
      .set({ ...ownershipUpdate, updatedAt: agentBotProviders.updatedAt })
      .where(inArray(agentBotProviders.agentId, agentIds));

    // 14a. Agent-scoped connectors (custom plugins) ride along, or every
    // custom tool the agent carries stops resolving in the target scope.
    // Same-owner rows keep their credentials; a target owner change strips
    // them to reauthorization shells (member-handover policy).
    await rehomeAgentConnectorsForScopeTransfer(trx, {
      agentIds,
      targetUserId,
      targetWorkspaceId,
    });

    // 14b. Agent documents (Skills / VFS files) ride along: dedicated
    // agent-created documents move with binding + history, associated
    // personal documents stay behind with their binding detached. Without
    // this the agent's Documents list arrives empty and the files strand in
    // the source scope's Resource list.
    const movedDocumentIds = await moveAgentDocumentsForScopeTransfer(trx, {
      agentIds,
      movedTaskIds,
      movedTopicIds,
      targetUserId,
      targetVisibility,
      targetWorkspaceId,
    });

    // 14c. Topic- and task-document junction rows denormalize the owner
    // scope, but a junction only resolves when BOTH it and its document pass
    // the target predicate — `TopicDocumentModel.findByTopicId` and
    // `TaskModel.getDocumentsPinnedSince` join the two. So the split can only
    // be decided once 14b has said which documents actually moved: links
    // whose document rode along follow their topic/task, and the rest are
    // detached. Kept, they would be rows no scope can resolve — invisible in
    // the target, orphaned in the source once their topic/task left it.
    if (movedTopicIds.length > 0) {
      const onMovedTopics = inArray(topicDocuments.topicId, movedTopicIds);
      if (movedDocumentIds.length > 0) {
        await trx
          .update(topicDocuments)
          .set(ownershipUpdate)
          .where(and(onMovedTopics, inArray(topicDocuments.documentId, movedDocumentIds)));
      }
      await trx
        .delete(topicDocuments)
        .where(
          movedDocumentIds.length > 0
            ? and(onMovedTopics, notInArray(topicDocuments.documentId, movedDocumentIds))
            : onMovedTopics,
        );
    }

    if (movedTaskIds.length > 0) {
      const onMovedTasks = inArray(taskDocuments.taskId, movedTaskIds);
      if (movedDocumentIds.length > 0) {
        await trx
          .update(taskDocuments)
          .set({ ...ownershipUpdate, ...visibilityUpdate })
          .where(and(onMovedTasks, inArray(taskDocuments.documentId, movedDocumentIds)));
      }
      await trx
        .delete(taskDocuments)
        .where(
          movedDocumentIds.length > 0
            ? and(onMovedTasks, notInArray(taskDocuments.documentId, movedDocumentIds))
            : onMovedTasks,
        );
    }

    // 15. Leave every chat group: a group belongs to the source scope, and a
    // roster row pointing at an agent that now lives elsewhere would render
    // as a member nobody in either scope can use. Guard 1c above has already
    // rejected the memberships where leaving would damage the GROUP, so
    // everything reaching here is a `referenced` link the caller confirmed.
    await trx.delete(chatGroupsAgents).where(inArray(chatGroupsAgents.agentId, agentIds));

    return agentIds.map((id) => ({
      agentId: id,
      slug: resolvedSlugs.get(id) ?? agentById.get(id)?.slug ?? null,
      transferJobId,
    }));
  });
};

/**
 * Cross-scope agent transfer as one unit of work. Moving an agent rehomes its
 * sessions, topics, messages, threads, tasks (and their child rows),
 * expertise, documents and connectors in a single transaction, so the flow
 * lives here rather than in `AgentModel`; the read-only guards
 * (`AgentModel.transferHasForeignRows`, the pending-job checks) stay with
 * their models.
 */
export class AgentTransferRepository {
  private readonly ctx: AgentModelContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.ctx = createAgentModelContext({ db, userId, workspaceId });
  }

  /** See {@link transferAgents}. */
  transferAgents = (
    agentIds: string[],
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
    options: AgentTransferOptions = {},
  ): Promise<{ agentId: string; slug: string | null; transferJobId: string | null }[]> =>
    transferAgents(this.ctx, agentIds, targetWorkspaceId, targetUserId, targetVisibility, options);
}
