import { and, eq, or, type SQL, sql } from 'drizzle-orm';

import { goals } from '../schemas';
import { buildWorkspaceWhere } from './workspace';

/**
 * Workspace scope for the `goals` table, honouring the creator's visibility.
 *
 * A goal has no visibility column, so `buildWorkspaceWhere` alone would make
 * every goal in a workspace readable by every member — including its
 * requirement, its graph, its findings and its whole event log. The creator's
 * choice is kept on `config.visibility` and enforced here, so a private goal
 * is scoped to the person who created it the same way a private task is.
 *
 * A real column that `buildWorkspaceWhere` can take directly is the better
 * long-term shape; this reads the JSON so the guarantee holds without one.
 */
export const buildGoalScopeWhere = (ctx: { userId: string; workspaceId?: string }): SQL => {
  const workspaceWhere = buildWorkspaceWhere(ctx, goals);
  if (!ctx.workspaceId) return workspaceWhere;

  return and(
    workspaceWhere,
    or(
      sql`${goals.config} ->> 'visibility' IS DISTINCT FROM 'private'`,
      eq(goals.userId, ctx.userId),
    ),
  ) as SQL;
};
