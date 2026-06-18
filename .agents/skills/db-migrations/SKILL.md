---
name: db-migrations
description: 'Use for Drizzle migrations: schema/table/column changes, migration generation or regeneration, sequence conflicts after rebase, idempotent SQL review, or migration renames.'
user-invocable: false
---

# Database Migrations Guide

## Development-stage schema changes

Schema changes churn during feature development. When the schema changes before the migration has shipped, do not hand-edit the existing migration SQL to chase the new schema shape. Delete the draft migration artifacts added by this branch (SQL file, matching snapshot, and matching journal entry), then run the generator again and re-apply the normal migration review steps below.

For example, if this branch's draft migration is `0110_add_verify_tables_and_ai_infra_id`:

```bash
# 1. Delete the draft SQL and its snapshot
rm packages/database/migrations/0110_add_verify_tables_and_ai_infra_id.sql
rm packages/database/migrations/meta/0110_snapshot.json

# 2. Remove the matching 0110 entry from the journal's "entries" array
#    packages/database/migrations/meta/_journal.json

# 3. Regenerate from the current schema
bun run db:generate
```

This keeps the generated SQL, snapshot, and journal aligned with the actual schema. Manual SQL edits are reserved for review-time hardening such as idempotent clauses, custom extension SQL, and meaningful filename/tag updates.

Before release, if a feature branch accumulated multiple development-only migrations, consolidate them into one migration when possible. Production does not need to replay every intermediate draft shape, and fewer migrations reduce deploy-time risk.

For example, if this branch added `0110`, `0111`, and `0112`, delete all three drafts and regenerate a single migration:

```bash
# 1. Delete every draft SQL and snapshot this branch added
rm packages/database/migrations/011{0,1,2}_*.sql
rm packages/database/migrations/meta/011{0,1,2}_snapshot.json

# 2. Remove the 0110/0111/0112 entries from the journal's "entries" array
#    packages/database/migrations/meta/_journal.json

# 3. Regenerate one migration covering the full schema delta
bun run db:generate
```

Do not make a migration compatible with earlier development-only versions of the same branch. While the migration has not shipped, there is no production history to preserve. Fix local/dev databases directly with whatever SQL is simplest (drop the draft table, rename a column, delete draft rows), then regenerate the branch migration from the current schema.

For example, if an earlier draft on this branch created `signup_attempt_id` and you have since renamed it to `user_signup_log_id`, do not add a compatibility `ALTER ... RENAME` to the migration. Just fix the dev DB directly (see the `access-pg` skill for the `bun -e` + `pg` pattern), then regenerate:

```bash
# Fix the dev DB to match the new schema (simplest SQL wins)
set -a && source .env && set +a && bun -e '
import pg from "pg";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("ALTER TABLE user_signup_logs DROP COLUMN signup_attempt_id");
await client.end();
'

# Regenerate so the migration reflects only the final shape
bun run db:generate
```

After a migration has reached production or the target default branch, treat it as immutable: add a follow-up migration instead of rewriting it.

## Rebase conflicts

When a rebase conflicts in migration files, keep the upstream/default-branch migrations and remove all migrations introduced by the current feature branch. Complete the rebase, then regenerate this branch's migration from the rebased schema. This avoids merging two independent snapshots or hand-splicing journal entries.

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
