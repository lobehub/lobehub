// @vitest-environment node
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findJsonbNullTests } from './jsonbNullTestGuard';

/**
 * `IS [NOT] NULL` applied to an *extracted* jsonb value inside a WHERE clause
 * crashes the query planner — SQLSTATE XX000 `rt_fetch used out-of-bounds` —
 * before a single row is read.
 *
 * The culprit is `pg_search` (ParadeDB BM25), not Postgres and not the hosting
 * provider: the crash appears the moment the scanned table carries a `bm25`
 * index and disappears when that index is dropped. Reproduced from an empty
 * scratch table on pg_search 0.15.26. Consequences that shape this guard:
 *
 * - It fires at PLAN time. `EXPLAIN` alone crashes, so an empty table crashes
 *   exactly like a full one, and no amount of test data can surface it.
 * - Stock Postgres, PGlite and any table without a bm25 index run these
 *   predicates perfectly happily — which is why every test we have stays green
 *   while production burns. `getDueScheduledTopics` shipped fully green and its
 *   cron then crashed on every tick for days.
 * - Today's bm25 tables are `agents`, `chat_groups`, `documents`, `files`,
 *   `knowledge_bases`, `messages`, `topics`, `user_memories*` and
 *   `user_memory_persona_documents` — but that list is one migration away from
 *   growing, and a predicate written today outlives the index list. So the rule
 *   is table-independent: never write the shape at all.
 *
 * A source-shape guard is the only thing that can hold this line, which is why
 * this asserts on the text of the query rather than on its behavior.
 *
 * The fix is always the same — COALESCE the extracted value to a sentinel:
 *
 *   (metadata ->> 'x') IS NULL              → COALESCE(metadata ->> 'x', '') = ''
 *   (metadata ->> 'x') IS NOT NULL          → COALESCE(metadata ->> 'x', '') <> ''
 *   (metadata ->> 'x') IS DISTINCT FROM 'y' → COALESCE(metadata ->> 'x', '') <> 'y'
 *
 * …or test key existence directly, which is also GIN-friendly:
 * `metadata ? 'x'`, `NOT COALESCE(jsonb_exists(metadata, 'x'), false)`.
 *
 * Prior casualties: `getLatestSpineMessageId` (#16693), `getDueScheduledTopics`
 * (#17077), and the `->>` predicate behind #13040.
 */

// Every directory whose queries can reach production. `models` is where the
// casualties lived, but a predicate is just as lethal when it is hoisted into a
// shared util or a repository — this guard follows the code.
const SRC_DIR = path.join(import.meta.dirname, '..', '..');
const SCANNED_DIRS = ['models', 'repositories', 'utils'].map((dir) => path.join(SRC_DIR, dir));

describe('jsonb null tests in WHERE clauses', () => {
  it('are absent from every query source — they take the query planner down', () => {
    const offenders = findJsonbNullTests(SCANNED_DIRS, SRC_DIR);

    expect(offenders).toEqual([]);
  });
});
