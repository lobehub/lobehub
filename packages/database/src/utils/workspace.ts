import { and, eq, getTableName, isNull, or, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { notTrashed } from './softDelete';

/**
 * Tables carrying the recycle-bin columns (`softDeleteColumns()` in
 * `schemas/_helpers.ts`). For these, `buildWorkspaceWhere` transparently adds
 * `is_deleted IS NOT TRUE` whenever the caller passes the whole table (or a `cols`
 * object carrying `isDeleted`), so a trashed row is invisible to every
 * ownership-scoped read in the codebase — models, repositories and services
 * alike — without each of the ~250 call sites opting in.
 *
 * Tables that use `deleted_at` with *other* semantics (`agent_documents`,
 * `topic_comments` tombstones, `workspace_members`) never carry `is_deleted`
 * and are therefore never matched.
 *
 * Restore / purge internals pass `includeTrashed: true` to reach stamped rows.
 */
export const TRASH_AWARE_TABLES: ReadonlySet<string> = new Set([
  'agent_cron_jobs',
  'agent_skills',
  'agents',
  'chat_groups',
  'documents',
  'files',
  'generation_batches',
  'generation_topics',
  'generations',
  'goals',
  'knowledge_bases',
  'messages',
  'projects',
  'session_groups',
  'tasks',
  'threads',
  'topics',
  'user_memories',
  'works',
]);

const isTrashFlag = (col: AnyPgColumn | undefined): col is AnyPgColumn =>
  !!col && col.name === 'is_deleted' && TRASH_AWARE_TABLES.has(getTableName(col.table));

/**
 * Workspace-aware ownership predicate for content tables.
 *
 * Compat mode semantics:
 * - `ctx.workspaceId` set → row belongs to that team workspace. By default
 *   visible to all members; `user_id` only records the creator and isn't part
 *   of the filter. When a `visibility` column is provided, private rows are
 *   additionally constrained to `user_id = ctx.userId` so each member only
 *   sees their own private items.
 * - `ctx.workspaceId` absent → personal mode: row belongs to a single user
 *   with `workspace_id IS NULL` (visibility is ignored — every personal row
 *   is implicitly private to its owner).
 *
 * Used by content router models (agent / session / message / file / topic …)
 * to replace the previous `userId = ?` only filter.
 *
 * @example Model-side
 * ```ts
 * import { buildWorkspaceWhere } from '../utils/workspace';
 *
 * class AgentModel {
 *   constructor(db, userId, workspaceId) { ... }
 *
 *   findById = (id) =>
 *     this.db.query.agents.findFirst({
 *       where: and(
 *         eq(agents.id, id),
 *         buildWorkspaceWhere(
 *           { userId: this.userId, workspaceId: this.workspaceId },
 *           agents,
 *         ),
 *       ),
 *     });
 * }
 * ```
 */
export function buildWorkspaceWhere(
  ctx: {
    /**
     * Visibility of the agent that owns the calling tool execution.
     *
     * - `'public'` — workspace-shared agent: rows scoped to the caller as
     *   "private" are excluded. Prevents a public agent from reading its
     *   caller's private data (e.g. private Pages) and echoing them back
     *   into a shared surface. Mirrors the task side's
     *   `assertAgentVisibilityCompat` (`public task ≠ private agent`).
     * - `'private'` / `null` / omitted — no tightening. Reads flow through
     *   the standard "public rows + own private rows" filter, so a private
     *   agent (or a direct TRPC call) can still see the caller's private
     *   content.
     */
    callerAgentVisibility?: 'private' | 'public' | null;
    /**
     * Skip the recycle-bin filter — for restore / purge / trash-listing
     * internals only. Every ordinary read must leave this unset.
     */
    includeTrashed?: boolean;
    userId: string;
    workspaceId?: string;
  },
  cols: {
    isDeleted?: AnyPgColumn;
    userId: AnyPgColumn;
    visibility?: AnyPgColumn;
    workspaceId: AnyPgColumn;
  },
): SQL {
  const base = buildScopeWhere(ctx, cols);
  if (ctx.includeTrashed || !isTrashFlag(cols.isDeleted)) return base;
  return and(base, notTrashed(cols.isDeleted)) as SQL;
}

function buildScopeWhere(
  ctx: {
    callerAgentVisibility?: 'private' | 'public' | null;
    userId: string;
    workspaceId?: string;
  },
  cols: { userId: AnyPgColumn; visibility?: AnyPgColumn; workspaceId: AnyPgColumn },
): SQL {
  if (!ctx.workspaceId) {
    return and(eq(cols.userId, ctx.userId), isNull(cols.workspaceId)) as SQL;
  }

  const workspaceMatch = eq(cols.workspaceId, ctx.workspaceId);
  if (!cols.visibility) return workspaceMatch;

  // Public agent gate: drop the "creator's own private rows" branch so a
  // workspace-public agent cannot read caller-private content even when it
  // holds the caller's session (which would otherwise grant that access).
  if (ctx.callerAgentVisibility === 'public') {
    const publicOnly = or(isNull(cols.visibility), eq(cols.visibility, 'public')) as SQL;
    return and(workspaceMatch, publicOnly) as SQL;
  }

  // Workspace + visibility-aware mode: every member sees public rows; private
  // rows are scoped to their creator. NULL visibility is treated as public for
  // backwards compatibility with rows that pre-date the column.
  const visibilityFilter = or(
    isNull(cols.visibility),
    eq(cols.visibility, 'public'),
    and(eq(cols.visibility, 'private'), eq(cols.userId, ctx.userId)),
  ) as SQL;

  return and(workspaceMatch, visibilityFilter) as SQL;
}

/**
 * Companion to `buildWorkspaceWhere` for INSERT payloads.
 *
 * Always sets `userId` (the creator) and `workspaceId` (nullable). Personal-mode
 * writes get `workspaceId: null`; team-mode writes get the workspace id.
 *
 * @example
 * ```ts
 * await db.insert(agents).values(
 *   buildWorkspacePayload(
 *     { userId: ctx.userId, workspaceId: ctx.workspaceId },
 *     { title: input.title, description: input.description },
 *   ),
 * );
 * ```
 */
export function buildWorkspacePayload<T extends object>(
  ctx: { userId: string; workspaceId?: string },
  base: T,
): T & { userId: string; workspaceId: string | null } {
  return {
    ...base,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  };
}
