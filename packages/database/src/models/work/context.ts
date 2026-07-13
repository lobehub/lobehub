import type { SQL } from 'drizzle-orm';
import { and, eq, ne, or, sql } from 'drizzle-orm';

import { agentDocuments } from '../../schemas/agentDocuments';
import { documents } from '../../schemas/file';
import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
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
 * `buildWorkspaceWhere` only scopes Works to the workspace; task rows
 * additionally carry their own `visibility`, so without this any member could
 * read another member's private-task Work (snapshot title and identifier, plus
 * live name/instruction/status via the task join). The registrant branch keeps
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

export const workOwnership = (ctx: WorkContext) =>
  and(
    buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, works),
    taskVisibilityGuard(ctx),
  ) as SQL;

export const versionOwnership = (ctx: WorkContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, workVersions);

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
