import type { SQL } from 'drizzle-orm';
import { and, eq, ne, or, sql } from 'drizzle-orm';

import { agentDocuments } from '../../schemas/agentDocuments';
import { documents } from '../../schemas/file';
import { tasks } from '../../schemas/task';
import { works } from '../../schemas/work';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * Ambient dependencies every Work query/mutation needs. Passed as the first
 * argument to the per-type free functions instead of `this`, so the per-type
 * modules never import the `WorkModel` facade (keeping the dependency graph
 * acyclic).
 */
export interface WorkContext {
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Row-level guard for task Works: visible iff the viewer registered the Work
 * themselves OR can see the live task under the public-or-owner rule.
 * `buildWorkspaceWhere` filters the mirrored `works.visibility`; this live
 * resource check is defense in depth for stale/moved resources and direct DB
 * mutations that bypass the visibility cascade. The registrant branch keeps
 * orphaned Works (task row hard-deleted outside the tool path) rendering from
 * their snapshot for their creator, while an orphan of a formerly-private task
 * never leaks its snapshot to other members — the trade-off is that other
 * members also lose orphan cards of public tasks, which is marginal. Write
 * paths sharing `workOwnership` are safe under the guard: a Work write is
 * always driven by a task mutation the actor performed, which the task tool
 * layer already gates with the same public-or-owner rule (see `TaskModel`'s
 * ownership predicate).
 */
const taskVisibilityGuard = (ctx: WorkContext): SQL =>
  or(
    ne(works.resourceType, 'task'),
    eq(works.userId, ctx.userId),
    // Raw EXISTS instead of a `ctx.db.select()` subquery builder so the guard
    // stays a pure predicate. NULL visibility predates the column and is
    // treated as public, mirroring `buildWorkspaceWhere`.
    sql`exists (select 1 from ${tasks} where ${tasks.id} = ${works.resourceId} and (${tasks.visibility} is null or ${tasks.visibility} = 'public' or ${tasks.createdByUserId} = ${ctx.userId}))`,
  ) as SQL;

/**
 * Row-level guard for document Works, mirroring {@link taskVisibilityGuard}:
 * `works.visibility` is the indexed primary filter; this live resource check
 * additionally prevents a stale or moved backing document from exposing its
 * Work snapshot. Visible iff the viewer registered the Work themselves OR can
 * see the backing document under the public-or-owner rule.
 *
 * Unlike tasks, `documents.visibility` is NOT NULL default 'public', so there is
 * no null branch to treat as public. Orphaned document Works (backing row
 * hard-deleted outside the tool path) fall back to registrant-only — the same
 * trade-off the task guard makes: an orphan of a formerly-private document never
 * leaks to other members, at the cost of other members also losing orphan cards
 * of public documents.
 */
const documentVisibilityGuard = (ctx: WorkContext): SQL =>
  or(
    ne(works.resourceType, 'document'),
    eq(works.userId, ctx.userId),
    sql`exists (select 1 from ${documents} where ${documents.id} = ${works.resourceId} and (${documents.visibility} = 'public' or ${documents.userId} = ${ctx.userId}))`,
  ) as SQL;

export const workOwnership = (ctx: WorkContext) =>
  and(
    buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, works),
    taskVisibilityGuard(ctx),
    documentVisibilityGuard(ctx),
  ) as SQL;

/**
 * Public-or-owner predicate for the live `tasks` join/lookup — mirrors
 * `TaskModel`'s visibility-aware ownership so Work registration and the
 * summary join can never see a task the task tool layer itself would hide.
 */
export const taskOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    { userId: tasks.createdByUserId, visibility: tasks.visibility, workspaceId: tasks.workspaceId },
  );

export const documentOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, documents);

export const agentDocumentOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, agentDocuments);
