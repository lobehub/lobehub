import { TRPCError } from '@trpc/server';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { agents } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from './workspace';

interface AgentAccessCtx {
  userId: string;
  workspaceId?: string;
}

/**
 * The one predicate behind "may this caller use that agent": a public agent in
 * the same workspace, or one the caller owns. Shared by the assertion below and
 * by {@link agentUsableBy}, so the guard and the row filter cannot drift.
 */
const usableAgentWhere = (ctx: AgentAccessCtx) =>
  buildWorkspaceWhere(ctx, {
    isDeleted: agents.isDeleted,
    userId: agents.userId,
    visibility: agents.visibility,
    workspaceId: agents.workspaceId,
  });

/**
 * Row-level form of {@link assertAgentUsableBy}: restrict rows that hang off an
 * agent (its accounts, its inbox) to agents the caller may use.
 *
 * Workspace ownership alone is not enough for such rows. They carry no
 * `visibility` of their own, so `buildWorkspaceWhere` would show every member
 * the rows of a colleague's *private* agent; the owning agent's visibility is
 * what decides.
 */
export const agentUsableBy = (
  db: LobeChatDatabase,
  agentIdColumn: AnyPgColumn,
  ctx: AgentAccessCtx,
): SQL =>
  inArray(agentIdColumn, db.select({ id: agents.id }).from(agents).where(usableAgentWhere(ctx)));

/**
 * Assert that `ctx.userId` in `ctx.workspaceId` is allowed to use the agent —
 * i.e. it's a public agent in the same workspace OR owned by the caller.
 *
 * Cross-user access to someone else's private agent (and any cross-workspace
 * lookup) throws `NOT_FOUND` rather than `FORBIDDEN`, so a caller cannot probe
 * for the existence of a private agent they don't own.
 *
 * Use at every entry point that stores an agentId for later execution
 * (task assignee, group member, signal marker, bot binding ...) and as a
 * fail-closed guard at execution time. The single predicate keeps every
 * surface in sync with `buildWorkspaceWhere` semantics.
 */
export async function assertAgentUsableBy(
  db: LobeChatDatabase,
  agentId: string,
  ctx: AgentAccessCtx,
): Promise<void> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), usableAgentWhere(ctx)))
    .limit(1);

  if (rows.length === 0) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' });
  }
}
