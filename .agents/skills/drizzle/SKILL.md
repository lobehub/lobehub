---
name: drizzle
description: 'LobeHub Drizzle ORM schema and query style. Use for pgTable schemas, indexes, joins, inferred types, db.select/db.query, schema fields, foreign keys, junction tables, or postgres query patterns.'
user-invocable: false
---

# Drizzle ORM Schema Style Guide

> **Adding a Model or Repository?** Ship a sibling test in the same PR — every new
> file under `packages/database/src/models/**` or `src/repositories/**` needs a
> matching `__tests__/<name>.test.ts`. See the **testing** skill
> (`.agents/skills/testing/references/db-model-test.md`) for the `getTestDB()`
> integration pattern, user-isolation tests, the BM25 `describe.skipIf(!isServerDB)`
> guard, and schema gotchas. CI's coverage patch gate won't reliably catch a brand-new
> untested file, so this is on you.

## Configuration

- Config: `drizzle.config.ts`
- Schemas: `packages/database/src/schemas/`
- Migrations: `packages/database/migrations/`
- Dialect: `postgresql` with `strict: true`

## Helper Functions

Location: `packages/database/src/schemas/_helpers.ts`

- `timestamptz(name)`: Timestamp with timezone
- `createdAt()`, `updatedAt()`, `accessedAt()`: Standard timestamp columns
- `timestamps`: Object with all three for easy spread

## Naming Conventions

- **Tables**: Plural snake_case (`users`, `session_groups`)
- **Columns**: snake_case (`user_id`, `created_at`)
- **New tables**: Check nearby existing tables before naming a new one. Preserve
  the established noun family and suffix. For example, if the user-scoped table
  is `user_xxx_logs`, the workspace-scoped counterpart should be
  `workspace_xxx_logs`, not `workspace_xxx_records` or another new synonym.

```typescript
// ✅ Good: follows the existing user/workspace table family.
export const userSignupLogs = pgTable('user_signup_logs', { ... });
export const workspaceSignupLogs = pgTable('workspace_signup_logs', { ... });

// ❌ Bad: introduces a new suffix for the same concept.
export const workspaceSignupRecords = pgTable('workspace_signup_records', { ... });
```

## Column Definitions

### Primary Keys

Do not use auto-incrementing primary keys (`serial`, `bigserial`, generated
identity columns). They create sequence-state problems during cross-database
migrations, restores, and data copy jobs. Prefer text IDs from application
generators (`idGenerator`, `createNanoId`) or `uuid` for internal tables.

Keep `$defaultFn(...)` when a table normally owns ID generation. Callers can
still pass an explicit `id`; the default only runs when the insert omits it. Do
not remove the default just because one flow needs to supply a request-scoped ID.

```typescript
// ✅ Good: app-generated text ID; explicit inserts can still override it.
id: text('id')
  .primaryKey()
  .$defaultFn(() => idGenerator('agents'))
  .notNull(),

// ❌ Bad: sequence state is fragile across DB migrations and restores.
id: serial('id').primaryKey(),
```

ID prefixes make entity types distinguishable. For internal tables, use `uuid`.

### Foreign Keys

```typescript
userId: text('user_id')
  .references(() => users.id, { onDelete: 'cascade' })
  .notNull(),
```

### Timestamps

```typescript
...timestamps,  // Spread from _helpers.ts
```

### Optional and Undefined Values

Do not introduce artificial sentinel strings for missing values, such as
`unknown`, unless the domain already has that explicit state and existing code
uses it consistently. Prefer nullable columns, optional TypeScript fields, or a
separate concrete status enum when the value is genuinely absent.

```typescript
// ✅ Good: absent until the final stage writes a real decision.
export type UserSignupLogFinalDecision = 'allow' | 'block' | 'error';

finalDecision: varchar('final_decision', { length: 32 }).$type<UserSignupLogFinalDecision>(),

// ❌ Bad: invents a new state that callers now need to handle everywhere.
export type UserSignupLogFinalDecision = 'allow' | 'block' | 'error' | 'unknown';

finalDecision: varchar('final_decision', { length: 32 })
  .$type<UserSignupLogFinalDecision>()
  .notNull()
  .default('unknown');
```

### Database Enums

Default to **not** using PostgreSQL/Drizzle `pgEnum`. Database enums are
expensive to evolve safely: adding members needs migrations, removing or
renaming members is awkward, and deployment order becomes more fragile.

For product/business states, use `text()` or `varchar()` with a TypeScript value
type via `$type<...>()`. Keep those TS-only value types in the domain/shared type
module, then import them into the schema. For cloud DB schemas, that usually
means `cloudDB/types.ts`.

Do not copy existing DB enums as a pattern. Treat them as legacy or explicitly
reviewed exceptions. If a new `pgEnum` seems necessary, stop and justify why the
value set is effectively immutable and why the migration cost is acceptable.

### Field Descriptions

For columns whose meaning is not obvious from the name alone, add JSDoc on the
schema field. Include a concrete example when it clarifies the stored value or
the lifecycle moment that writes it. This is especially important for external
IDs, lifecycle statuses, denormalized snapshots, JSONB signals, and fields whose
name could mean either a request ID or a persisted row ID.

```typescript
// ✅ Good: explain the table's business object first, then only document
// non-obvious lifecycle or risk-control fields.
/**
 * User signup logs - one row per signup flow, collecting stage-level
 * risk-control decisions before and after the auth provider creates a user.
 */
export const userSignupLogs = pgTable('user_signup_logs', {
  /** Final signup outcome reason, for example user_created, llm_block, or guard_error */
  finalReason: text('final_reason'),

  /** Aggregated risk level derived from stage decisions, for example block -> high */
  riskLevel: varchar('risk_level', { length: 16 }).$type<UserSignupLogRiskLevel>(),

  /** Ordered stage-level decisions and metadata grouped by signup review stage */
  stageResults: jsonb('stage_results').$type<UserSignupLogStageResults>(),
});

// ❌ Bad: comments restate obvious column names without adding domain meaning.
/** User email */
email: text('email'),
```

### JSONB Types

Avoid `Record<string, unknown>` or similarly loose JSONB types for schema
columns. Define a concrete interface that describes the expected JSON shape, even
when most properties are optional. This keeps callers, migrations, and review
queries aligned on the same data contract.

```typescript
interface UserSignupLogMetadata {
  payloadPath?: string;
  requestPath?: string;
}

metadata: jsonb('metadata').$type<UserSignupLogMetadata>(),
```

```typescript
// ❌ Bad: hides the contract and makes downstream access untyped.
metadata: jsonb('metadata').$type<Record<string, unknown>>(),
```

### Indexes

```typescript
// Return array (object style deprecated)
(t) => [uniqueIndex('client_id_user_id_unique').on(t.clientId, t.userId)],
```

## Type Inference

```typescript
export const insertAgentSchema = createInsertSchema(agents);
export type NewAgent = typeof agents.$inferInsert;
export type AgentItem = typeof agents.$inferSelect;
```

## Example Pattern

```typescript
export const agents = pgTable(
  'agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('agents'))
      .notNull(),
    slug: varchar('slug', { length: 100 })
      .$defaultFn(() => randomSlug(4))
      .unique(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id'),
    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('client_id_user_id_unique').on(t.clientId, t.userId)],
);
```

## Common Patterns

### Junction Tables (Many-to-Many)

```typescript
export const agentsKnowledgeBases = pgTable(
  'agents_knowledge_bases',
  {
    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    knowledgeBaseId: text('knowledge_base_id')
      .references(() => knowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    enabled: boolean('enabled').default(true),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.agentId, t.knowledgeBaseId] })],
);
```

## Query Style

**Always use `db.select()` builder API. Never use `db.query.*` relational API** (`findMany`, `findFirst`, `with:`).

The relational API generates complex lateral joins with `json_build_array` that are fragile and hard to debug.

### Select Single Row

```typescript
// ✅ Good
const [result] = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
return result;

// ❌ Bad: relational API
return this.db.query.agents.findFirst({
  where: eq(agents.id, id),
});
```

### Select with JOIN

```typescript
// ✅ Good: explicit select + leftJoin
const rows = await this.db
  .select({
    runId: agentEvalRunTopics.runId,
    score: agentEvalRunTopics.score,
    testCase: agentEvalTestCases,
    topic: topics,
  })
  .from(agentEvalRunTopics)
  .leftJoin(agentEvalTestCases, eq(agentEvalRunTopics.testCaseId, agentEvalTestCases.id))
  .leftJoin(topics, eq(agentEvalRunTopics.topicId, topics.id))
  .where(eq(agentEvalRunTopics.runId, runId))
  .orderBy(asc(agentEvalRunTopics.createdAt));

// ❌ Bad: relational API with `with:`
return this.db.query.agentEvalRunTopics.findMany({
  where: eq(agentEvalRunTopics.runId, runId),
  with: { testCase: true, topic: true },
});
```

### Select with Aggregation

```typescript
// ✅ Good: select + leftJoin + groupBy
const rows = await this.db
  .select({
    id: agentEvalDatasets.id,
    name: agentEvalDatasets.name,
    testCaseCount: count(agentEvalTestCases.id).as('testCaseCount'),
  })
  .from(agentEvalDatasets)
  .leftJoin(agentEvalTestCases, eq(agentEvalDatasets.id, agentEvalTestCases.datasetId))
  .groupBy(agentEvalDatasets.id);
```

### Raw SQL and Advanced Queries

Prefer Drizzle builders whenever the query reads clearly with `select`,
`insert().select()`, `update().from()`, joins, CTEs, and `groupBy` — this keeps
table/column references tied to schema, so changes surface as TypeScript errors.
Within a builder, expression-level `sql<T>` is fine for features lacking a helper
(JSON path, casts, aggregates, `CASE`, `NOW()`). Row locks are clauses, not
expressions — use `.for('update')`, never raw `FOR UPDATE`.

Use `COALESCE` only when null-handling is part of required DB semantics (nullable
JSONB append/merge, "keep first non-null"). Don't scatter
`COALESCE(excluded.col, current.col)` across ordinary upsert scalars just to avoid
an update object — build `set` from defined values only, and hide any remaining
SQL behind named helpers (`appendJsonbArray`, `mergeJsonbObject`, `keepFirstValue`)
so the method reads as business intent, not SQL plumbing.

```typescript
// ✅ Scalars included only when present; SQL hidden behind a named helper.
const updateValues = compactUndefined({
  email: record.email ?? undefined,
  ip: record.ip ?? undefined,
});
await db.insert(userSignupLogs).values(values).onConflictDoUpdate({
  set: { ...updateValues, stageResults: appendStageResult(stage, result), updatedAt: now },
  target: userSignupLogs.id,
});

// ❌ Every scalar becomes SQL plumbing.
set: {
  email: sql`COALESCE(excluded.email, ${userSignupLogs.email})`,
  ip: sql`COALESCE(excluded.ip, ${userSignupLogs.ip})`,
}
```

When refactoring raw SQL:

- Preserve query shape on latency-sensitive paths. If raw SQL is one roundtrip,
  don't split it into multiple depth-based queries just to drop `execute`.
- Use `$with(...)` + `insert().select()` / `update().from()` for multi-step
  single-roundtrip writes Drizzle can express.
- Don't rely on `execute<MyRow>(sql...)` for safety — it types rows but doesn't keep
  selected columns in sync with schema changes.
- If only a PostgreSQL feature Drizzle can't express works, keep the raw SQL and
  tighten it: schema refs in interpolations, explicit user scope, a narrow row
  interface, and regression tests.

Recursive CTEs are the canonical "keep raw" case — there's no clean `WITH RECURSIVE`
builder, and a rewrite would add depth-based roundtrips:

```typescript
interface TaskTreeRow {
  id: string;
  parent_task_id: string | null;
}

// execute<T> acceptable: no clean WITH RECURSIVE builder. Keep schema refs in the
// interpolations and scope every leg to the user.
const { rows } = await db.execute<TaskTreeRow>(sql`
  WITH RECURSIVE task_tree AS (
    SELECT ${tasks.id}, ${tasks.parentTaskId}
    FROM ${tasks}
    WHERE ${tasks.id} = ${rootTaskId} AND ${tasks.createdByUserId} = ${userId}
    UNION ALL
    SELECT ${tasks.id}, ${tasks.parentTaskId}
    FROM ${tasks}
    JOIN task_tree ON ${tasks.parentTaskId} = task_tree.id
    WHERE ${tasks.createdByUserId} = ${userId}
  )
  SELECT * FROM task_tree
`);
```

### One-to-Many (Separate Queries)

When you need a parent record with its children, use two queries instead of relational `with:`:

```typescript
// ✅ Good: two simple queries
const [dataset] = await this.db
  .select()
  .from(agentEvalDatasets)
  .where(eq(agentEvalDatasets.id, id))
  .limit(1);

if (!dataset) return undefined;

const testCases = await this.db
  .select()
  .from(agentEvalTestCases)
  .where(eq(agentEvalTestCases.datasetId, id))
  .orderBy(asc(agentEvalTestCases.sortOrder));

return { ...dataset, testCases };
```

## Database Migrations

See the `db-migrations` skill for the detailed migration guide.
