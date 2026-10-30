import { TRPCError } from '@trpc/server';
import { and, eq, inArray } from 'drizzle-orm';

import { RESERVED_AGENT_SLUGS } from '../../models/agent/constants';
import { type AgentModelContext, createAgentModelContext } from '../../models/agent/context';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../../models/agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../../models/agentTransferJob';
import { agents, agentsToSessions, channelJobs, channelMembers, sessions } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { isTrashed } from '../../utils/softDelete';

/**
 * Delete an agent and its associated session.
 * This will cascade delete messages, topics, etc. through the session deletion.
 */
const deleteAgent = async (ctx: AgentModelContext, agentId: string) => {
  return ctx.db.transaction(async (trx) => {
    // Lock the agent row BEFORE consulting the pending-copy guard — same
    // lock-then-guard order as transferAgents. A concurrent copy enqueue
    // locks the same source rows, so the guard here cannot run in the window
    // where the enqueue's job row exists but is not yet committed.
    const [locked] = await trx
      .select({ id: agents.id, slug: agents.slug })
      .from(agents)
      .where(and(eq(agents.id, agentId), ctx.ownership()))
      .for('update');

    // Builtins (the inbox, the agent builders) are provisioned per user and
    // carry `virtual` exactly like a group's own members. Deleting one takes
    // its linked session and every conversation with it, and nothing can
    // recreate them — refuse here, the same way `addAgentsToGroup` refuses to
    // seat one. This only guards callers of `AgentModel.delete` /
    // `AgentDeletionRepository.deleteAgent`; paths that
    // delete `agents` rows directly (e.g. the OpenAPI `migrateSessionTo`
    // delete) bypass it.
    if (locked?.slug && RESERVED_AGENT_SLUGS.has(locked.slug)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A builtin agent cannot be deleted',
      });
    }

    // The junction records every agent an unfinished job still maps, a
    // copy's TARGET included — and a group copy's drain writes those ids into
    // `messages.agent_id`. Deleting one leaves the queue rows behind, so the
    // drain hits a missing-agent FK and retries forever, stranding the copied
    // conversations as pending. Distinct from the source guard below: a copy
    // registers only its target here.
    if (await AgentTransferJobModel.hasPendingJobForAgents(trx, [agentId])) {
      throw new Error(AGENT_TRANSFER_IN_PROGRESS);
    }

    // Not covered above: a group transfer that left this agent behind and
    // took a clone does NOT register it as a covered agent (it never moved).
    // But its id is still the live value of `messages.agent_id` on every
    // topic the drain has not reached yet, and that column cascades — so
    // deleting it now would destroy the moved group history the remap is
    // partway through rescuing.
    if (await AgentTransferJobModel.hasPendingRemapForSourceAgents(trx, [agentId])) {
      throw new Error(AGENT_TRANSFER_IN_PROGRESS);
    }

    // A pending copy job still reads this agent's topics — deleting it would
    // cascade them away and the copy would silently complete with empty
    // conversations. Surface the in-progress state instead.
    if (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(trx, [agentId])) {
      throw new Error(AGENT_COPY_IN_PROGRESS);
    }

    // 1. Get associated session IDs
    const links = await trx
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), ctx.agentsToSessionsOwnership()));

    const sessionIds = links.map((link) => link.sessionId);

    // 2. Delete links in agentsToSessions
    await trx
      .delete(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, agentId), ctx.agentsToSessionsOwnership()));

    // 3. Delete associated sessions (this will cascade delete messages, topics, etc.)
    if (sessionIds.length > 0) {
      await trx
        .delete(sessions)
        .where(and(inArray(sessions.id, sessionIds), ctx.sessionsOwnership()));
    }

    // 4. Delete the agent itself
    return trx.delete(agents).where(and(eq(agents.id, agentId), ctx.ownership()));
  });
};

/**
 * Agent deletion as one unit of work: the agent row, its session links and
 * the legacy session shells (which cascade their messages and topics) go in
 * one transaction, under the agent row lock and the pending-job guards.
 * Sessions are their own aggregate, so the flow lives here rather than in
 * `AgentModel`; `AgentModel.delete` forwards to it.
 */
export class AgentDeletionRepository {
  private readonly ctx: AgentModelContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.ctx = createAgentModelContext({ db, userId, workspaceId });
  }

  /** See {@link deleteAgent}. */
  deleteAgent = (agentId: string) => deleteAgent(this.ctx, agentId);

  /**
   * Called inside the trash transaction, after the owned Agent row has been locked and
   * stamped. Retain members and public messages as history, but stop accepting work.
   * Do not take channel locks after the Agent lock: channel claims take them in the
   * opposite order. Claims hold a shared Agent lock and recheck its deletion flag.
   * Revoked writers keep their lock until the coordinator confirms physical exit.
   */
  retireChannelMemberships = async (agentId: string): Promise<string[]> => {
    const { db } = this.ctx;
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), this.ctx.trashScope(), isTrashed(agents.isDeleted)));
    if (!agent) return [];

    const members = await db
      .select({ channelId: channelMembers.channelId, id: channelMembers.id })
      .from(channelMembers)
      .where(eq(channelMembers.agentId, agentId));
    if (!members.length) return [];

    const memberIds = members.map((member) => member.id);
    await db
      .update(channelMembers)
      .set({ status: 'removed' })
      .where(and(inArray(channelMembers.id, memberIds), eq(channelMembers.status, 'active')));
    await db
      .update(channelJobs)
      .set({
        blockedCode: null,
        blockedReason: null,
        publicationRevoked: true,
        status: 'cancelled',
      })
      .where(
        and(
          inArray(channelJobs.memberId, memberIds),
          inArray(channelJobs.status, ['queued', 'running']),
        ),
      );

    return [...new Set(members.map((member) => member.channelId))];
  };
}
