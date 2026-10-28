import type { SQL, SQLWrapper } from 'drizzle-orm';
import { and, eq, getTableColumns, getTableName, isNull, sql, Subquery } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import type { LobeChatDatabase } from '../../../type';
import { notTrashed } from '../../../utils/softDelete';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import type { FtsSearchBackendScope } from '../types';
import type { PostgresFtsSearchDialect, PostgresFtsSearchField } from './dialect';

/**
 * Evaluate BM25 scores before non-indexed visibility predicates and joins.
 * OFFSET 0 is a PostgreSQL subquery boundary: without it the planner can pull
 * score() above a join, or abandon the custom scan for a non-indexed predicate.
 * pg_search < 0.21 then returns NULL; newer releases reject that query shape.
 * Keep the boundary unbounded so hidden rows cannot consume the result limit.
 */
export function createScoredScan(
  context: PostgresFtsSearchContext,
  table: PgTable & { id: AnyPgColumn; userId: AnyPgColumn },
  fields: PostgresFtsSearchField[],
  preparedQuery: string,
) {
  const { db, dialect } = context;
  const score = dialect.score(table.id, fields, preparedQuery);
  const match = dialect.match(fields, preparedQuery);
  if (!dialect.isolatesScoredScan) return { match, score, source: table };

  const scan = db
    .select({ ...getTableColumns(table), bm25Score: score.as('bm25_score') })
    .from(table)
    .where(and(context.scope.workspaceId ? undefined : eq(table.userId, context.userId), match));
  // Drizzle omits .offset(0); preserve the boundary using its public Subquery API.
  const source = new Subquery(sql`${scan} offset 0`, {}, getTableName(table));

  return {
    match: undefined,
    score: sql<number>`${sql.identifier(getTableName(table))}.${sql.identifier('bm25_score')}`,
    source,
  };
}

/** Columns shared by the workspace-aware tables searched by the PostgreSQL providers. */
export interface PostgresFtsSearchWorkspaceScopedColumns {
  isDeleted?: AnyPgColumn;
  userId: AnyPgColumn;
  visibility?: AnyPgColumn;
  workspaceId: AnyPgColumn;
}

/**
 * Shared state and query-shaping helpers used by the PostgreSQL provider modules.
 */
export interface PostgresFtsSearchContext {
  db: LobeChatDatabase;
  dialect: PostgresFtsSearchDialect;
  liftedScopeWhere: (workspaceIdColumn: SQLWrapper) => SQL | undefined;
  liftsAgentFilter: boolean;
  /**
   * Whether non-indexed exclusions (restricted knowledge bases) sit above the
   * candidate scan. ParadeDB retains the existing pool and lets restricted
   * rows consume pool slots; plain PostgreSQL applies them inside the exact
   * scan so a restricted top hit cannot take a slot from an authorized one.
   */
  liftsExclusionFilter: boolean;
  liftsWorkspaceFilter: boolean;
  scanCandidateLimit: (limit: number) => number;
  scanScopeWhere: (cols: PostgresFtsSearchWorkspaceScopedColumns) => SQL;
  scope: FtsSearchBackendScope;
  userId: string;
}

/**
 * Retain the existing personal-mode candidate pool and hydration contract.
 * Scoring itself is isolated by createScoredScan before these filters run.
 * Workspace rows can consume pool slots, so personal searches deepen the pool.
 */
const WORKSPACE_FILTER_CANDIDATE_MULTIPLIER = 5;

/** See `WORKSPACE_FILTER_CANDIDATE_MULTIPLIER`; this floor protects small limits. */
const WORKSPACE_FILTER_MIN_CANDIDATES = 500;

/**
 * Candidate pool used when the active-agent filter is lifted above the BM25
 * scan. Agent IDs are not BM25 fields, so the pool must be deep enough for a
 * small agent to survive the outer filter.
 */
const AGENT_SCOPE_CANDIDATE_POOL = 20_000;

/**
 * Flip to `true` once every BM25 index used by this repo carries `workspace_id`
 * as a fast keyword field. At that point ownership can stay inline and
 * personal-mode search becomes exact again.
 */
const WORKSPACE_ID_IN_BM25_INDEX = false;

export function createPostgresFtsSearchContext(
  db: LobeChatDatabase,
  scope: FtsSearchBackendScope,
  dialect: PostgresFtsSearchDialect,
): PostgresFtsSearchContext {
  // The original backend copied scope fields in its constructor. Keep the same
  // snapshot semantics instead of retaining a caller-owned mutable object.
  const normalizedScope: FtsSearchBackendScope = {
    callerAgentVisibility: scope.callerAgentVisibility,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  };
  // Preserve ParadeDB's existing candidate pools. The plain PostgreSQL dialect
  // keeps every filter inline and needs no candidate over-fetching.
  const liftsWorkspaceFilter =
    dialect.isolatesScoredScan && !WORKSPACE_ID_IN_BM25_INDEX && !normalizedScope.workspaceId;
  const liftsAgentFilter =
    dialect.isolatesScoredScan && (WORKSPACE_ID_IN_BM25_INDEX || !normalizedScope.workspaceId);

  return {
    db,
    dialect,
    liftedScopeWhere: (workspaceIdColumn) =>
      liftsWorkspaceFilter ? (isNull(workspaceIdColumn) as SQL) : undefined,
    liftsAgentFilter,
    liftsExclusionFilter: dialect.isolatesScoredScan,
    liftsWorkspaceFilter,
    scanCandidateLimit: (limit) =>
      liftsWorkspaceFilter
        ? Math.max(limit * WORKSPACE_FILTER_CANDIDATE_MULTIPLIER, WORKSPACE_FILTER_MIN_CANDIDATES)
        : limit,
    scanScopeWhere: (cols) => {
      if (!liftsWorkspaceFilter) return buildWorkspaceWhere(normalizedScope, cols);

      return and(
        eq(cols.userId, normalizedScope.userId),
        cols.isDeleted ? notTrashed(cols.isDeleted) : undefined,
      ) as SQL;
    },
    scope: normalizedScope,
    userId: normalizedScope.userId,
  };
}

export { AGENT_SCOPE_CANDIDATE_POOL, WORKSPACE_FILTER_CANDIDATE_MULTIPLIER };
