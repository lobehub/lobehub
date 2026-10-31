import { and, inArray } from 'drizzle-orm';

import { agents, agentsToSessions } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { AGENT_COPY_IN_PROGRESS, AgentCopyJobModel } from '../agentCopyJob';
import { AGENT_TRANSFER_IN_PROGRESS, AgentTransferJobModel } from '../agentTransferJob';
import { type AgentModelContext } from './context';

// **************** Recycle bin *************** //

/**
 * Same pre-flight as {@link delete}: an agent whose history is mid-copy or
 * mid-transfer must not disappear from under the job. Runs the guards under
 * the same row lock so the check cannot race an enqueue. Throws
 * `AGENT_TRANSFER_IN_PROGRESS` / `AGENT_COPY_IN_PROGRESS`.
 */
export const assertDeletable = async (
  ctx: AgentModelContext,
  agentIds: string[],
  trx?: Transaction,
) => {
  if (agentIds.length === 0) return;
  const run = async (tx: Transaction | LobeChatDatabase) => {
    await tx
      .select({ id: agents.id })
      .from(agents)
      .where(and(inArray(agents.id, agentIds), ctx.trashScope()))
      .for('update');
    if (await AgentTransferJobModel.hasPendingJobForAgents(tx, agentIds)) {
      throw new Error(AGENT_TRANSFER_IN_PROGRESS);
    }
    if (await AgentTransferJobModel.hasPendingRemapForSourceAgents(tx, agentIds)) {
      throw new Error(AGENT_TRANSFER_IN_PROGRESS);
    }
    if (await AgentCopyJobModel.hasPendingCopyJobForSourceAgents(tx, agentIds)) {
      throw new Error(AGENT_COPY_IN_PROGRESS);
    }
  };
  return trx ? run(trx) : run(ctx.db);
};

/** Legacy session shells linked to the given agents (used to stamp `topics.session_id` rows). */
export const findSessionIdsByAgentIds = async (
  ctx: AgentModelContext,
  agentIds: string[],
): Promise<string[]> => {
  if (agentIds.length === 0) return [];
  const links = await ctx.db
    .select({ sessionId: agentsToSessions.sessionId })
    .from(agentsToSessions)
    .where(and(inArray(agentsToSessions.agentId, agentIds), ctx.agentsToSessionsOwnership()));
  return [...new Set(links.map((link) => link.sessionId))];
};

/** Agents linked to the given legacy session shells — the reverse of {@link findSessionIdsByAgentIds}. */
export const findAgentIdsBySessionIds = async (
  ctx: AgentModelContext,
  sessionIds: string[],
): Promise<string[]> => {
  if (sessionIds.length === 0) return [];
  const links = await ctx.db
    .select({ agentId: agentsToSessions.agentId })
    .from(agentsToSessions)
    .where(and(inArray(agentsToSessions.sessionId, sessionIds), ctx.agentsToSessionsOwnership()));
  return [...new Set(links.map((link) => link.agentId))];
};

/**
 * Batch delete agents by IDs.
 * This is a simpler delete that only removes the agent records.
 * Use this for virtual agents that don't have associated sessions.
 */
export const batchDelete = async (ctx: AgentModelContext, agentIds: string[]) => {
  if (agentIds.length === 0) return;

  return ctx.db.delete(agents).where(and(ctx.ownership(), inArray(agents.id, agentIds)));
};
