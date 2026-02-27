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
