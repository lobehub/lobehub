# Database Model Testing Guide

Test the `packages/database` Model and Repository layers.

> **Rule: every new Model or Repository ships with a sibling test in the same PR.**
> A new file under `src/models/**` or `src/repositories/**` must have a matching
> `__tests__/<name>.test.ts`. Coverage runs in server-db mode in CI and the patch
> gate will not always catch a brand-new untested file (a small new file barely
> moves the project total) — so this is a convention, not something CI guarantees.
> Start from the template: `packages/database/src/models/__tests__/_test_template.ts`.

## Two test environments: client-db vs server-db

`getTestDB()` (`src/core/getTestDB.ts`) returns different engines based on the
`TEST_SERVER_DB` env var:

| Mode                    | Engine                              | When               | Notes                                                                                                                                                               |
| ----------------------- | ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **client-db** (default) | PGlite (in-memory)                  | `bunx vitest run`  | Migration runner **skips any SQL containing `pg_search` / `bm25`** — the ParadeDB BM25 `@@@` operator does not exist here.                                          |
| **server-db**           | node-postgres → `DATABASE_TEST_URL` | `TEST_SERVER_DB=1` | CI uses the `paradedb/paradedb` image (has `pg_search`). **Coverage is measured in this mode** (`test:coverage` → `vitest.config.server.mts`, uploaded to Codecov). |

```bash
# 1. Client environment (fast, default — what most local runs use)
cd packages/database && bunx vitest run --silent='passed-only' '[file]'

# 2. Server environment (BM25 / pg_search / pgvector parity, needs DATABASE_TEST_URL)
cd packages/database && TEST_SERVER_DB=1 bunx vitest run --silent='passed-only' '[file]'
```

Implication: client-db coverage **under-counts** any code that needs BM25 (e.g.
`repositories/search/index.ts` reads near-0% locally but is fully covered in CI).
Don't chase those lines locally — confirm via CI/Codecov.

## BM25 / full-text search → `describe.skipIf(!isServerDB)`

Any method using the BM25 `@@@` operator or `sanitizeBm25` (keyword search:
`queryByKeyword`, `searchAgents`, userMemory lexical search, …) **throws under
PGlite** (often swallowed by a `catch` that returns `[]`, so the test silently
fails with empty results). Guard those blocks so they only run in server-db:

```typescript
// BM25 search requires the pg_search extension (ParadeDB), not available in PGlite
const isServerDB = process.env.TEST_SERVER_DB === '1';
describe.skipIf(!isServerDB)('queryByKeyword', () => {
  /* ... */
});
```

Convention already used in `session.test.ts`, `topic.query.test.ts`,
`message.query.test.ts`, `home/index.test.ts`, `repositories/search/index.test.ts`.

## Setup boilerplate

Top-of-file pattern (see `_test_template.ts` for the full version). Use real DB
integration via `getTestDB()` — **not a mocked `vi.fn()` db**; the integration
style exercises real SQL and gives far deeper coverage.

```typescript
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { MyModel } from '../myModel';

const serverDB: LobeChatDatabase = await getTestDB(); // top-level await is fine

const userId = 'my-model-test-user';
const otherUserId = 'other-user';
const myModel = new MyModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users); // cascades to user-scoped rows
});
```

Some tests need the Node environment (pgvector, server-only deps) — add
`// @vitest-environment node` as the first line when required.

## User permission check — security first 🔒

**Every user-data operation must be ownership-scoped.** Always add a test proving
another user cannot read/update/delete the row.

```typescript
// ✅ SECURE: ownership in the WHERE clause
update = async (id: string, data: Partial<MyModel>) =>
  this.db
    .update(myTable)
    .set(data)
    .where(and(eq(myTable.id, id), eq(myTable.userId, this.userId)))
    .returning();
```

```typescript
it('should NOT update another user's record', async () => {
  const otherModel = new MyModel(serverDB, otherUserId);
  const [row] = await otherModel.create({ data: 'original' });

  await myModel.update(row.id, { data: 'hacked' });

  const unchanged = await serverDB.query.myTable.findFirst({
    where: eq(myTable.id, row.id),
  });
  expect(unchanged?.data).toBe('original');
});
```

## What to cover

Aim each model/repository as close to 100% as practical (excluding BM25):

- Every public method
- Both branches of conditionals; empty-list / `if (!x) return []` early returns
- Error fallbacks (e.g. decrypt/JSON-parse failure → `null`)
- Filters, pagination, ordering branches
- Ownership / user isolation, and workspace scoping if the model takes a `workspaceId`

## Schema gotchas (real traps that fail inserts or types)

- **`workspaces`** requires `{ id, name, slug, primaryOwnerId }` and has **no
  `userId` column** — `insert(workspaces).values({ id, name, slug, primaryOwnerId })`.
- **uuid columns**: a "not found" test must pass a _valid_ UUID
  (`'00000000-0000-0000-0000-000000000000'`); a random string raises a `22P02`
  DB error instead of returning `undefined`/`null`.
- **Enum / `$type` columns** are type-checked: e.g. `files.source` is a
  `FileSource` enum (`image_generation` | `page-editor` | `video_generation`),
  not free text — passing `'upload'` is a type error.
- Read the table's schema in `src/schemas/` for `notNull` columns **without
  defaults**; you must supply those on insert.

## Foreign key handling

```typescript
// ❌ Wrong: invalid foreign key
const testData = { asyncTaskId: 'invalid-uuid', fileId: 'non-existent' };

// ✅ Use null …
const testData = { asyncTaskId: null, fileId: null };

// ✅ … or create the referenced row first
const [asyncTask] = await serverDB.insert(asyncTasks).values({ status: 'pending' }).returning();
testData.asyncTaskId = asyncTask.id;
```

## Predictable sorting

```typescript
// ✅ Use explicit timestamps — never rely on insert order
await serverDB.insert(table).values([
  { ...data1, createdAt: new Date('2024-01-01T10:00:00Z') },
  { ...data2, createdAt: new Date('2024-01-02T10:00:00Z') },
]);
```

## Checking coverage of one file

```bash
# Per-file coverage; read the "Uncovered Line #s" column to find gaps
cd packages/database
bunx vitest run --coverage --silent='passed-only' '[test-file]' 2>&1 | grep '[sourceFile].ts'
```

## Before finishing

1. Tests pass: `bunx vitest run --silent='passed-only' '[file]'`
2. Types pass: `bun run type-check` (vitest uses esbuild and does **not**
   type-check — a green test run can still have type errors).
