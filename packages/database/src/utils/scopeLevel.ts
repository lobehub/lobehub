import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { agents } from '../schemas/agent';
import { projects } from '../schemas/project';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from './workspace';

// Ownership levels for entities that can live directly on a user, a workspace,
// a project or an agent (optionally inside a project) — widgets today, other
// mountable entities later. The level is derived from which of the nullable
// `project_id` / `agent_id` columns are set; the workspace always comes from
// the caller context.

/** The optional parents that pick a row's direct level. */
export interface ScopeLevelFilter {
  agentId?: string | null;
  projectId?: string | null;
}

export type ScopeLevelErrorCode = 'AGENT_NOT_FOUND' | 'PROJECT_NOT_FOUND' | 'SCOPE_MISMATCH';

/**
 * Raised when a row would be attached to a project or agent the caller cannot
 * see, or whose workspace differs from the row's own.
 */
export class ScopeLevelError extends Error {
  constructor(
    public readonly code: ScopeLevelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScopeLevelError';
  }
}

interface ScopeCtx {
  userId: string;
  workspaceId?: string;
}

type ParentVisibility = 'private' | 'public';

interface ScopeParent {
  id: string;
  visibility: ParentVisibility;
}

/** The resolved parents of a scope; a key is present only when that parent was requested. */
export interface ScopeParents {
  agent?: ScopeParent;
  project?: ScopeParent;
}

/**
 * Whether any attached parent is private. A child of a private parent must
 * not be more visible than the parent itself, or it would leak the parent's
 * existence (and its own content) to the whole workspace.
 */
export const hasPrivateParent = (parents: ScopeParents): boolean =>
  parents.project?.visibility === 'private' || parents.agent?.visibility === 'private';

/**
 * Enforce the ownership invariant of level-scoped rows: an attached project /
 * agent must be visible to the caller and live in the same workspace as the
 * row (both NULL in personal mode). The row's workspace is always the caller
 * context's workspace, so checking the parent against the context is
 * sufficient. Returns the resolved parents with their visibility so the
 * caller can tighten the row's own visibility.
 */
export const assertScopeParents = async (
  db: LobeChatDatabase,
  ctx: ScopeCtx,
  scope: ScopeLevelFilter,
): Promise<ScopeParents> => {
  const expectedWorkspaceId = ctx.workspaceId ?? null;
  const parents: ScopeParents = {};

  if (scope.projectId) {
    // `buildWorkspaceWhere` applies visibility and skips trashed projects.
    const [project] = await db
      .select({ id: projects.id, visibility: projects.visibility })
      .from(projects)
      .where(and(eq(projects.id, scope.projectId), buildWorkspaceWhere(ctx, projects)))
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
        throw new ScopeLevelError(
          'SCOPE_MISMATCH',
          'Project belongs to a different workspace than the record',
        );
      }
      throw new ScopeLevelError('PROJECT_NOT_FOUND', 'Project not found');
    }
    parents.project = project;
  }

  if (scope.agentId) {
    const [agent] = await db
      .select({ id: agents.id, visibility: agents.visibility })
      .from(agents)
      .where(and(eq(agents.id, scope.agentId), buildWorkspaceWhere(ctx, agents)))
      .limit(1);

    if (!agent) {
      const [other] = await db
        .select({ workspaceId: agents.workspaceId })
        .from(agents)
        .where(and(eq(agents.id, scope.agentId), eq(agents.userId, ctx.userId)))
        .limit(1);
      if (other && other.workspaceId !== expectedWorkspaceId) {
        throw new ScopeLevelError(
          'SCOPE_MISMATCH',
          'Agent belongs to a different workspace than the record',
        );
      }
      throw new ScopeLevelError('AGENT_NOT_FOUND', 'Agent not found');
    }
    parents.agent = agent;
  }

  return parents;
};

/**
 * Predicate selecting rows that live *directly* on one level:
 *
 * - agent given → that agent, and the given project or none
 * - project only → that project, without an agent
 * - neither → the context level (personal or workspace) with no project/agent
 *
 * Combine with `buildWorkspaceWhere` for access control.
 */
export const buildDirectLevelWhere = (
  cols: { agentId: AnyPgColumn; projectId: AnyPgColumn },
  filter: ScopeLevelFilter,
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

/**
 * Predicate selecting everything that belongs to a project, whether or not an
 * agent inside the project also owns it — what a project's page shows.
 * Combine with `buildWorkspaceWhere` for access control.
 */
export const buildProjectWhere = (cols: { projectId: AnyPgColumn }, projectId: string): SQL =>
  eq(cols.projectId, projectId);

/**
 * Read gate for level-scoped rows: a row attached to a project or agent is
 * readable only while the caller can see that parent *now*. A row's own
 * `visibility` is clamped when it is written, but a parent can turn private
 * or be trashed later — without this gate a still-'public' child would keep
 * exposing the parent's content.
 *
 * A parent hides its children when it sits in the recycle bin (personal and
 * workspace mode alike), or — in workspace mode — when it is private and the
 * caller is not its creator (NULL visibility counts as public, as in
 * `buildWorkspaceWhere`). Restoring or re-publishing the parent shows them
 * again.
 *
 * Combine with `buildWorkspaceWhere` for every ordinary read.
 */
export const buildParentVisibilityWhere = (
  ctx: ScopeCtx,
  cols: { agentId: AnyPgColumn; projectId: AnyPgColumn },
): SQL => {
  const hiddenProject = ctx.workspaceId
    ? sql`${projects.isDeleted} IS TRUE OR (${projects.visibility} = 'private' AND ${projects.userId} <> ${ctx.userId})`
    : sql`${projects.isDeleted} IS TRUE`;
  const hiddenAgent = ctx.workspaceId
    ? sql`${agents.isDeleted} IS TRUE OR (${agents.visibility} = 'private' AND ${agents.userId} <> ${ctx.userId})`
    : sql`${agents.isDeleted} IS TRUE`;

  return sql`NOT EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${cols.projectId} AND (${hiddenProject})) AND NOT EXISTS (SELECT 1 FROM ${agents} WHERE ${agents.id} = ${cols.agentId} AND (${hiddenAgent}))`;
};

/**
 * Cross-user counterpart of {@link buildParentVisibilityWhere} for trusted
 * jobs (the widget scheduler): keeps a row only while its *owner* could still
 * read it through its parents — no attached project / agent is trashed, and
 * none is private unless the row's owner created it.
 */
export const buildParentAccessibleToOwnerWhere = (cols: {
  agentId: AnyPgColumn;
  projectId: AnyPgColumn;
  userId: AnyPgColumn;
}): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.id} = ${cols.projectId} AND (${projects.isDeleted} IS TRUE OR (${projects.visibility} = 'private' AND ${projects.userId} <> ${cols.userId}))) AND NOT EXISTS (SELECT 1 FROM ${agents} WHERE ${agents.id} = ${cols.agentId} AND (${agents.isDeleted} IS TRUE OR (${agents.visibility} = 'private' AND ${agents.userId} <> ${cols.userId})))`;
