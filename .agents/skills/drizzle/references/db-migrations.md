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

Always use defensive clauses to make migrations idempotent:

```sql
-- ✅ Good: Idempotent operations
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar" text;
DROP TABLE IF EXISTS "old_table";
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
ALTER TABLE "posts" DROP COLUMN IF EXISTS "deprecated_field";

-- ❌ Bad: Non-idempotent operations
ALTER TABLE "users" ADD COLUMN "avatar" text;
DROP TABLE "old_table";
CREATE INDEX "users_email_idx" ON "users" ("email");
```

## Important

After modifying migration SQL (e.g., adding `IF NOT EXISTS` clauses), run:

```bash
bun run db:generate:client
```

This updates the hash in `packages/database/src/core/migrations.json`.
