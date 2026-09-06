// @vitest-environment node
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { Pool as NodePool } from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import * as schema from '../../schemas';
import { users } from '../../schemas/user';
import type { LobeChatDatabase } from '../../type';
import {
  describeFtsSearchProductBehavior,
  otherUserId,
  userId,
} from './__tests__/productSearchBehavior';
import { FtsSearchCandidateError, FtsSearchRepo } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

describe('FtsSearchRepo candidate search', () => {
  it('forwards candidate-only requests through the selected backend without product hydration', async () => {
    const backendFtsSearch = vi.fn().mockResolvedValue({
      candidates: [{ id: 'memory-context-1', score: 8 }],
      items: [],
      total: 1,
    });
    const repo = new FtsSearchRepo(serverDB, userId, undefined, undefined, {
      backend: { key: 'candidate', search: backendFtsSearch },
      ftsSearchCandidateEnabled: true,
    });

    await expect(
      repo.ftsSearchCandidates({
        entity: 'memoryContexts',
        filters: {
          memoryCategories: ['project'],
          memoryTags: ['typescript'],
          memoryTypes: ['workflow'],
        },
        pagination: { limit: 12 },
        query: {
          fields: ['parent_text', 'title', 'description', 'current_status'],
          text: 'search phrase',
        },
      }),
    ).resolves.toEqual({ candidates: [{ id: 'memory-context-1', score: 8 }], total: 1 });
    expect(backendFtsSearch).toHaveBeenCalledWith({
      entity: 'memoryContexts',
      filters: {
        memoryCategories: ['project'],
        memoryTags: ['typescript'],
        memoryTypes: ['workflow'],
      },
      mode: 'candidates',
      pagination: { limit: 12 },
      query: {
        fields: ['parent_text', 'title', 'description', 'current_status'],
        text: 'search phrase',
      },
      scope: { callerAgentVisibility: undefined, userId, workspaceId: undefined },
    });
  });

  it('marks provider failures so API boundaries cannot mistake them for legacy fallbacks', async () => {
    const providerError = new Error('Elasticsearch unavailable');
    const repo = new FtsSearchRepo(serverDB, userId, undefined, undefined, {
      backend: { key: 'candidate', search: vi.fn().mockRejectedValue(providerError) },
      ftsSearchCandidateEnabled: true,
    });

    await expect(
      repo.ftsSearchCandidates({
        entity: 'memoryContexts',
        filters: {},
        pagination: { limit: 12 },
        query: { text: 'search phrase' },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        cause: providerError,
        name: FtsSearchCandidateError.name,
      }),
    );
  });
});

// BM25 search requires pg_search extension (ParadeDB), not available in PGlite
const isServerDB = process.env.TEST_SERVER_DB === '1';

/** Subquery alias each rewritten method gives its isolated BM25 scan. */
const SCAN_ALIASES = [
  'agent_hits',
  'chat_group_hits',
  'file_hits',
  'folder_hits',
  'knowledge_base_hits',
  'message_hits',
  'page_hits',
  'topic_hits',
];

// Provider-neutral product behaviour lives in the shared suite so a second FTS
// backend can be held to exactly the same expectations.
describe.skipIf(!isServerDB)('FtsSearchRepo (pg_search)', () => {
  describeFtsSearchProductBehavior({
    createRepo: (db, userId, workspaceId, callerAgentVisibility) =>
      new FtsSearchRepo(db, userId, workspaceId, callerAgentVisibility),
    db: serverDB,
  });
});

describe.skipIf(!isServerDB)('FtsSearchRepo', () => {
  beforeEach(async () => {
    // Clean up
    await serverDB.delete(users);

    // Create test users
    await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  });

  // The shared suite's workspace-scoping tests pin *results*, and this change is
  // deliberately result-neutral — they pass against the pre-fix implementation
  // too. What actually fixes the regression is the *shape* of the emitted SQL, so
  // it needs its own guard: ParadeDB only picks `TopNScanExecState` when the
  // scan node itself carries the whole `ORDER BY paradedb.score() LIMIT n`.
  //
  // Asserting the plan directly is not an option in CI: the container runs a
  // newer pg_search than production, and its `heap_filter` keeps TopN even with
  // a non-indexed qual — the exact regression would be invisible. So we assert
  // the structural invariant that makes TopN reachable instead, which fails on
  // the pre-fix single-level query regardless of engine version.
  describe('search - BM25 scan shape', () => {
    let loggingPool: NodePool | undefined;

    afterAll(async () => {
      await loggingPool?.end();
    });

    interface CapturedStatement {
      params: unknown[];
      sql: string;
    }

    /** Runs a search against the test DB and returns every BM25 statement it emitted. */
    const captureScanSql = async (options?: {
      agentId?: string;
      workspaceId?: string;
    }): Promise<CapturedStatement[]> => {
      const captured: CapturedStatement[] = [];
      loggingPool ??= new NodePool({ connectionString: process.env.DATABASE_TEST_URL });
      const db = nodeDrizzle(loggingPool, {
        logger: {
          logQuery: (query: string, params: unknown[]) => captured.push({ params, sql: query }),
        },
        schema,
      });

      await new FtsSearchRepo(
        db as unknown as LobeChatDatabase,
        userId,
        options?.workspaceId,
      ).search({
        agentId: options?.agentId,
        query: 'kubernetes',
      });

      return captured.filter(({ sql }) => sql.includes('@@@'));
    };

    /** Body of the first parenthesised subquery, i.e. the isolated BM25 scan. */
    const innerScanOf = (query: string): string | undefined => {
      const open = query.indexOf('from (');
      if (open === -1) return undefined;

      const start = open + 'from ('.length;
      let depth = 1;
      for (let i = start; i < query.length; i++) {
        if (query[i] === '(') depth++;
        else if (query[i] === ')' && --depth === 0) return query.slice(start, i);
      }
      return undefined;
    };

    /** Locates one method's statement and returns its isolated scan, failing loudly if absent. */
    const scanOf = (statements: CapturedStatement[], alias: string): string => {
      const statement = statements.find(({ sql }) => sql.includes(`"${alias}"`));
      expect(statement, `no statement produced the ${alias} subquery`).toBeDefined();

      const scan = innerScanOf(statement!.sql);
      expect(scan, `${alias}: BM25 scan is not isolated in a subquery`).toBeDefined();

      return scan!;
    };

    const whereClauseOf = (scan: string): string =>
      scan.slice(scan.indexOf(' where '), scan.indexOf(' order by '));

    it('gives every rewritten method a join-free single-table BM25 scan', async () => {
      const statements = await captureScanSql();

      // memories is the one BM25 search that was intentionally left unsplit
      expect(statements).toHaveLength(SCAN_ALIASES.length + 1);

      for (const alias of SCAN_ALIASES) {
        const scan = scanOf(statements, alias);

        // the scan node owns the whole ranking clause …
        expect(scan).toContain('@@@');
        expect(scan).toContain('order by paradedb.score');
        expect(scan).toContain('limit');

        // … and nothing sits between it and that clause
        expect(scan, `${alias}: a join moved back inside the BM25 scan`).not.toContain(' join ');
      }
    });

    it('keeps the non-indexed workspace filter above the scan in personal mode', async () => {
      const statements = await captureScanSql();

      for (const alias of SCAN_ALIASES) {
        const where = whereClauseOf(scanOf(statements, alias));

        // `workspace_id` is not a BM25 field, so a qual on it inside the scan
        // is what costs TopN. It is still selected as a column for the outer
        // filter — only the scan's predicate has to stay clear of it.
        expect(where, `${alias}: workspace qual moved back into the BM25 scan`).not.toContain(
          'workspace_id',
        );
        expect(where).toContain('user_id');

        // the filter must survive somewhere, or scoping would silently break
        const statement = statements.find(({ sql }) => sql.includes(`"${alias}"`))!;
        expect(statement.sql).toContain(`"${alias}"."workspace_id" is null`);
      }
    });

    it('keeps the ownership predicate exact and inline in workspace mode', async () => {
      const statements = await captureScanSql({
        agentId: 'agent-under-test',
        workspaceId: 'search-test-workspace',
      });

      for (const alias of SCAN_ALIASES) {
        const where = whereClauseOf(scanOf(statements, alias));

        // Workspace mode has no pushdown-able owner column, so over-fetching
        // would silently drop rows. It keeps the exact predicate instead and
        // stays on the slower plan until the column is indexed.
        expect(where, `${alias}: workspace mode must not lift its own filter`).toContain(
          'workspace_id',
        );
      }

      // With the workspace qual inline, paradedb.score() is NULL for the whole
      // statement (pg_search 0.15.26), so a score-ordered pool cut would be an
      // arbitrary slice. The agent filter must therefore stay inline too —
      // exact, on the already-degraded plan.
      for (const alias of ['message_hits', 'topic_hits']) {
        const where = whereClauseOf(scanOf(statements, alias));
        expect(where, `${alias}: workspace mode must keep the agent filter inline`).toContain(
          'agent_id',
        );
      }
    });

    // Guard: `agent_id` is not a BM25 field either — inside the
    // scan it costs TopN and, on production pg_search 0.15.26, NULLs out every
    // score (arbitrary order, flat relevance 3). The agent filter must sit
    // above the scan, backed by a deepened candidate pool.
    it('keeps the non-indexed agent filter above the scan in agent context', async () => {
      const statements = await captureScanSql({ agentId: 'agent-under-test' });

      for (const alias of ['message_hits', 'topic_hits']) {
        const where = whereClauseOf(scanOf(statements, alias));
        expect(where, `${alias}: agent qual moved back into the BM25 scan`).not.toContain(
          'agent_id',
        );

        const statement = statements.find(({ sql }) => sql.includes(`"${alias}"`))!;

        // the filter must survive above the scan, or agent scoping would break
        expect(statement.sql).toContain(`"${alias}"."agent_id" = `);

        // and the pool deepens so small agents survive the lifted filter
        expect(statement.params, `${alias}: agent-scoped scan pool`).toContain(20_000);
      }
    });
  });
});
