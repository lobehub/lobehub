import type { SQL, SQLWrapper } from 'drizzle-orm';
import { eq, isNull } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { LobeChatDatabase } from '../../../type';
import { buildWorkspaceWhere } from '../../../utils/workspace';
import type { FtsSearchBackendScope } from '../types';

/** Columns shared by the workspace-aware tables searched by pg_search. */
export interface PgSearchFtsSearchWorkspaceScopedColumns {
  userId: AnyPgColumn;
  visibility?: AnyPgColumn;
  workspaceId: AnyPgColumn;
}

/** Shared state and query-shaping helpers used by the pg_search provider modules. */
export interface PgSearchFtsSearchContext {
  db: LobeChatDatabase;
  liftedScopeWhere: (workspaceIdColumn: SQLWrapper) => SQL | undefined;
  liftsAgentFilter: boolean;
  liftsWorkspaceFilter: boolean;
  scanCandidateLimit: (limit: number) => number;
  scanScopeWhere: (cols: PgSearchFtsSearchWorkspaceScopedColumns) => SQL;
  scope: FtsSearchBackendScope;
  userId: string;
}

/**
 * Every query here is shaped as "inner single-table BM25 scan → outer enrichment",
 * because ParadeDB only picks its TopN custom scan (`TopNScanExecState`, which
 * visits a handful of heap rows) when the scan node itself carries the whole
 * `ORDER BY paradedb.score() LIMIT n`. Joins and non-indexed ownership filters
 * therefore stay outside the scan whenever the score ordering remains valid.
 *
 * The workspace filter is currently not a fast field in the BM25 indexes. In
 * personal mode we keep the user filter in the scan and lift only the
 * `workspace_id IS NULL` half above it, using a deeper candidate pool to keep
 * personal rows from being displaced by workspace rows.
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

export function createPgSearchFtsSearchContext(
  db: LobeChatDatabase,
  scope: FtsSearchBackendScope,
): PgSearchFtsSearchContext {
  // The original backend copied scope fields in its constructor. Keep the same
  // snapshot semantics instead of retaining a caller-owned mutable object.
  const normalizedScope: FtsSearchBackendScope = {
    callerAgentVisibility: scope.callerAgentVisibility,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  };
  const liftsWorkspaceFilter = !WORKSPACE_ID_IN_BM25_INDEX && !normalizedScope.workspaceId;
  const liftsAgentFilter = WORKSPACE_ID_IN_BM25_INDEX || !normalizedScope.workspaceId;

  return {
    db,
    liftedScopeWhere: (workspaceIdColumn) =>
      liftsWorkspaceFilter ? (isNull(workspaceIdColumn) as SQL) : undefined,
    liftsAgentFilter,
    liftsWorkspaceFilter,
    scanCandidateLimit: (limit) =>
      liftsWorkspaceFilter
        ? Math.max(limit * WORKSPACE_FILTER_CANDIDATE_MULTIPLIER, WORKSPACE_FILTER_MIN_CANDIDATES)
        : limit,
    scanScopeWhere: (cols) => {
      if (!liftsWorkspaceFilter) return buildWorkspaceWhere(normalizedScope, cols);

      return eq(cols.userId, normalizedScope.userId) as SQL;
    },
    scope: normalizedScope,
    userId: normalizedScope.userId,
  };
}

export { AGENT_SCOPE_CANDIDATE_POOL, WORKSPACE_FILTER_CANDIDATE_MULTIPLIER };
