---
name: drizzle
description: Drizzle ORM schema and database guide. Use when working with database schemas (src/database/schemas/*), defining tables, creating migrations, or database model code. Triggers on Drizzle schema definition, database migrations, or ORM usage questions.
---

# Drizzle ORM Schema Style Guide

## Configuration

- Config: `drizzle.config.ts`
- Schemas: `src/database/schemas/`
- Migrations: `src/database/migrations/`
- Dialect: `postgresql` with `strict: true`

## Helper Functions

Location: `src/database/schemas/_helpers.ts`

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

## Database Migrations

See `references/db-migrations.md` for detailed migration guide.

```bash
# Generate migrations
bun run db:generate

# After modifying SQL (e.g., adding IF NOT EXISTS)
bun run db:generate:client
```

### Migration Best Practices

```sql
-- ✅ Idempotent operations
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar" text;
DROP TABLE IF EXISTS "old_table";
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

-- ❌ Non-idempotent
ALTER TABLE "users" ADD COLUMN "avatar" text;
```

Rename migration files meaningfully: `0046_meaningless.sql` → `0046_user_add_avatar.sql`
