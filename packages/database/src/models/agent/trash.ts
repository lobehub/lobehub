import { and, eq, inArray } from 'drizzle-orm';

import type { AgentItem } from '../../schemas';
import { agents, agentsToSessions } from '../../schemas';
import {
  isTrashed,
  restoreStamp,
  type SoftDeleteOptions,
  trashStamp,
} from '../../utils/softDelete';
import { type AgentModelContext } from './context';

/**
 * Move agents to the recycle bin. Only the `agents` rows are stamped here —
 * the server-side trash handler cascades to sessions / topics through their
 * own models so the registry can record each child.
 */
export const softDelete = async (
  ctx: AgentModelContext,
  agentIds: string[],
  options: SoftDeleteOptions,
): Promise<AgentItem[]> => {
  if (agentIds.length === 0) return [];
  return ctx.db
    .update(agents)
    .set(trashStamp(options.deletedAt))
    .where(
      and(
        inArray(agents.id, agentIds),
        ctx.ownership(),
        options.restrictToCreator ? eq(agents.userId, ctx.userId) : undefined,
      ),
    )
    .returning();
};

export const restore = async (ctx: AgentModelContext, agentIds: string[]): Promise<AgentItem[]> => {
  if (agentIds.length === 0) return [];
  return ctx.db
    .update(agents)
    .set(restoreStamp())
    .where(and(inArray(agents.id, agentIds), ctx.trashScope(), isTrashed(agents.isDeleted)))
    .returning();
};

export const findTrashedByIds = async (
  ctx: AgentModelContext,
  agentIds: string[],
): Promise<AgentItem[]> => {
  if (agentIds.length === 0) return [];
  return ctx.db
    .select()
    .from(agents)
    .where(and(inArray(agents.id, agentIds), ctx.trashScope(), isTrashed(agents.isDeleted)));
};

/**
 * Lock the given agents for a purge and return the ones still in the bin.
 * Run inside the caller's transaction: the row lock holds until the purge
 * commits, so a restore racing it waits and then finds nothing to restore,
 * while a restore that already committed makes this return no ids.
 */
export const lockTrashedForPurge = async (
  ctx: AgentModelContext,
  agentIds: string[],
): Promise<string[]> => {
  if (agentIds.length === 0) return [];
  const stamped = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(inArray(agents.id, agentIds), ctx.trashScope(), isTrashed(agents.isDeleted)))
    .for('update');
  return stamped.map((row) => row.id);
};

/**
 * Hard delete for the purge sweep: the agent rows and their session links,
 * still-stamped rows only. FK cascades take topics / messages / threads.
 * The legacy session shells are another aggregate — the trash handler
 * drops them through `SessionModel` in the same transaction.
 */
export const purge = async (ctx: AgentModelContext, agentIds: string[]): Promise<string[]> => {
  if (agentIds.length === 0) return [];
  await ctx.db
    .delete(agentsToSessions)
    .where(and(inArray(agentsToSessions.agentId, agentIds), ctx.agentsToSessionsOwnership()));
  const rows = await ctx.db
    .delete(agents)
    .where(and(inArray(agents.id, agentIds), ctx.trashScope(), isTrashed(agents.isDeleted)))
    .returning({ id: agents.id });
  return rows.map((row) => row.id);
};
