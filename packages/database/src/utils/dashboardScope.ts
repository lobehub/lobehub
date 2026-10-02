import type { DashboardLevelFilter } from '@lobechat/types';
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { agents } from '../schemas/agent';
import { projects } from '../schemas/project';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from './workspace';

export type DashboardScopeErrorCode = 'AGENT_NOT_FOUND' | 'PROJECT_NOT_FOUND' | 'SCOPE_MISMATCH';

/**
 * Raised when a dashboard / widget would be attached to a project or agent the
 * caller cannot see, or whose workspace differs from the record's own.
 */
export class DashboardScopeError extends Error {
  constructor(
    public readonly code: DashboardScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardScopeError';
  }
}

interface ScopeCtx {
  userId: string;
  workspaceId?: string;
}

/**
 * Enforce the ownership invariant of dashboards and widgets: an attached
 * project / agent must be visible to the caller and live in the same workspace
 * as the record (both NULL in personal mode). The record's workspace is always
 * the caller context's workspace, so checking the parent against the context
 * is sufficient.
 */
export const assertDashboardScope = async (
  db: LobeChatDatabase,
  ctx: ScopeCtx,
  scope: DashboardLevelFilter,
): Promise<void> => {
  const expectedWorkspaceId = ctx.workspaceId ?? null;

  if (scope.projectId) {
    const [project] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(
        and(
          eq(projects.id, scope.projectId),
          buildWorkspaceWhere(ctx, projects),
          isNotTrashed(projects.isDeleted),
        ),
      )
      .limit(1);

    if (!project) {
      // Distinguish "exists in another workspace" from "does not exist" so the
      // caller gets an actionable error without leaking row contents.
      const [other] = await db
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(and(eq(projects.id, scope.projectId), eq(projects.userId, ctx.userId)))
        .limit(1);
      if (other && other.workspaceId !== expectedWorkspaceId) {
        throw new DashboardScopeError(
          'SCOPE_MISMATCH',
          'Project belongs to a different workspace than the dashboard',
        );
      }
      throw new DashboardScopeError('PROJECT_NOT_FOUND', 'Project not found');
    }
  }

  if (scope.agentId) {
    const [agent] = await db
      .select({ workspaceId: agents.workspaceId })
      .from(agents)
      .where(
        and(
          eq(agents.id, scope.agentId),
          buildWorkspaceWhere(ctx, agents),
          isNotTrashed(agents.isDeleted),
        ),
      )
      .limit(1);

    if (!agent) {
      const [other] = await db
        .select({ workspaceId: agents.workspaceId })
        .from(agents)
        .where(and(eq(agents.id, scope.agentId), eq(agents.userId, ctx.userId)))
        .limit(1);
      if (other && other.workspaceId !== expectedWorkspaceId) {
        throw new DashboardScopeError(
          'SCOPE_MISMATCH',
          'Agent belongs to a different workspace than the dashboard',
        );
      }
      throw new DashboardScopeError('AGENT_NOT_FOUND', 'Agent not found');
    }
  }
};

/** `is_deleted IS NOT TRUE` — NULL is the live state, see `softDeleteColumns`. */
export const isNotTrashed = (col: AnyPgColumn): SQL => sql`${col} IS NOT TRUE`;

/**
 * Predicate selecting rows that live *directly* on one level:
 *
 * - agent given → that agent, and the given project or none
 * - project only → that project, without an agent
 * - neither → the context level (personal or workspace) with no project/agent
 *
 * Combine with `buildWorkspaceWhere` for access control.
 */
export const buildDashboardLevelWhere = (
  cols: { agentId: AnyPgColumn; projectId: AnyPgColumn },
  filter: DashboardLevelFilter,
): SQL => {
  if (filter.agentId) {
    return and(
      eq(cols.agentId, filter.agentId),
      filter.projectId ? eq(cols.projectId, filter.projectId) : isNull(cols.projectId),
    ) as SQL;
  }
  if (filter.projectId) {
    return and(eq(cols.projectId, filter.projectId), isNull(cols.agentId)) as SQL;
  }
  return and(isNull(cols.projectId), isNull(cols.agentId)) as SQL;
};
