---
name: drizzle
description: 'LobeHub Drizzle ORM schema and query style. Use for pgTable schemas, indexes, joins, inferred types, db.select/db.query, schema fields, foreign keys, junction tables, or postgres query patterns.'
user-invocable: false
---

# Drizzle ORM Schema Style Guide

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

## Column Definitions

### Primary Keys

```typescript
id: text('id')
  .primaryKey()
  .$defaultFn(() => idGenerator('agents'))
  .notNull(),
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

Prefer Drizzle builders whenever the query can be expressed clearly with `select`,
`insert().select()`, `update().from()`, joins, CTEs, `groupBy`, and typed selected
columns. This keeps table and column references tied to schema definitions, so
schema changes are more likely to surface as TypeScript errors.

Expression-level `sql<T>` is fine inside a Drizzle builder for PostgreSQL features
that do not have a dedicated helper, such as JSON path extraction, casts, aggregate
expressions, `CASE`, `NOW()`, or advisory locks. Row locks are query clauses, not
expressions; use the select builder's `.for('update')` instead of raw
`FOR UPDATE` SQL fragments.

When refactoring raw SQL:

- Preserve the original query shape for latency-sensitive paths. If raw SQL is one
  database roundtrip, do not replace it with multiple depth-based queries just to
  remove `execute`.
- Use `$with(...)` plus `insert().select()` / `update().from()` for multi-step
  single-roundtrip writes when Drizzle can express the data flow.
- Avoid generic `execute<MyRow>(sql...)` as the main safety mechanism. It types the
  returned rows, but it does not keep selected columns in sync with schema changes.
- If the only clean implementation is a PostgreSQL feature that Drizzle cannot
  express well, keep the raw SQL and tighten it instead: use schema references in
  interpolations, explicit user scope, a narrow row interface, and regression tests.

Recursive CTEs are a special case: current Drizzle usage in this repo does not have
a clean `WITH RECURSIVE` builder pattern. Keep recursive CTE raw SQL when replacing
it would add extra database roundtrips or materially worsen performance.

Example: convert an aggregate query when Drizzle can preserve one roundtrip:

```typescript
// ✅ Good: builder owns table and column references; sql<T> stays expression-level.
const rows = await trx
  .select({
    model: messages.model,
    provider: messages.provider,
    totalCost: sql<string | null>`sum((${messages.metadata}->'usage'->>'cost')::numeric)`.as(
      'totalCost',
    ),
  })
  .from(messages)
  .where(
    and(
      eq(messages.topicId, topicId),
      eq(messages.userId, userId),
      eq(messages.role, 'assistant'),
      sql`${messages.metadata} ? 'usage'`,
    ),
  )
  .groupBy(messages.provider, messages.model);
```

Example: use the select lock builder for row locks:

```typescript
const [user] = await trx.select().from(users).where(eq(users.id, userId)).for('update');
```

Example: keep a recursive CTE raw when replacing it would add depth-based DB
roundtrips:

```typescript
interface TaskTreeRow {
  id: string;
  parent_task_id: string | null;
}

// execute<T> is acceptable here only because Drizzle has no clean WITH RECURSIVE
// builder; a builder rewrite would add depth-based roundtrips. Keep schema refs in
// the interpolations and scope every leg to the user.
const { rows } = await db.execute<TaskTreeRow>(sql`
  WITH RECURSIVE task_tree AS (
    SELECT ${tasks.id}, ${tasks.parentTaskId}
    FROM ${tasks}
    WHERE ${tasks.id} = ${rootTaskId}
      AND ${tasks.createdByUserId} = ${userId}
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
