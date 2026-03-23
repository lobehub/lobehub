---
name: db-migrations
description: 'Use when generating or regenerating Drizzle migration files, changing database schema tables or columns, resolving migration sequence conflicts after rebase, reviewing migration SQL for idempotent patterns, or renaming migration files.'
---

# Database Migrations Guide

## Step 1: Generate Migrations

```bash
bun run db:generate
```

This generates:

- `packages/database/migrations/0046_meaningless_file_name.sql`

And updates:

- `packages/database/migrations/meta/_journal.json`
- `packages/database/src/core/migrations.json`
- `docs/development/database-schema.dbml`

## Custom Migrations (e.g. CREATE EXTENSION)

For migrations that don't involve Drizzle schema changes (e.g. enabling PostgreSQL extensions), use the `--custom` flag:

```bash
bunx drizzle-kit generate --custom --name=enable_pg_search
```

This generates an empty SQL file and properly updates `_journal.json` and snapshot. Then edit the generated SQL file to add your custom SQL:

```sql
-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS pg_search;
```

**Do NOT manually create migration files or edit `_journal.json`** — always use `drizzle-kit generate` to ensure correct journal entries and snapshots.

## Step 2: Optimize Migration SQL Filename

Rename auto-generated filename to be meaningful:

`0046_meaningless_file_name.sql` → `0046_user_add_avatar_column.sql`

## Step 3: Use Idempotent Clauses (Defensive Programming)

Always use defensive clauses to make migrations idempotent (safe to re-run):

### CREATE TABLE

```sql
-- ✅ Good
CREATE TABLE IF NOT EXISTS "agent_eval_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ❌ Bad
CREATE TABLE "agent_eval_runs" (...);
```

### ALTER TABLE - Columns

```sql
-- ✅ Good
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar" text;
ALTER TABLE "posts" DROP COLUMN IF EXISTS "deprecated_field";

-- ❌ Bad
ALTER TABLE "users" ADD COLUMN "avatar" text;
```

### ALTER TABLE - Foreign Key Constraints

PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`. Use `DROP IF EXISTS` + `ADD`:

```sql
-- ✅ Good: Drop first, then add (idempotent)
ALTER TABLE "agent_eval_datasets" DROP CONSTRAINT IF EXISTS "agent_eval_datasets_user_id_users_id_fk";
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- ❌ Bad: Will fail if constraint already exists
ALTER TABLE "agent_eval_datasets" ADD CONSTRAINT "agent_eval_datasets_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
```

### DROP TABLE / INDEX

```sql
-- ✅ Good
DROP TABLE IF EXISTS "old_table";
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" USING btree ("email");

-- ❌ Bad
DROP TABLE "old_table";
CREATE INDEX "users_email_idx" ON "users" ("email");
```

## Step 4: Update Journal Tag

After renaming the migration SQL file in Step 2, update the `tag` field in `packages/database/migrations/meta/_journal.json` to match the new filename (without `.sql` extension).
