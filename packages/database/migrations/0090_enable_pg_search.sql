-- Custom SQL migration file, put your code below! --
-- pg_search is optional: plain PostgreSQL services (Aiven, RDS, Neon projects without the
-- extension) run LobeHub with FTS_SEARCH_PROVIDER=pg_like or elasticsearch, so a missing
-- extension must not block the remaining migrations. The pg_search provider still fails
-- visibly at query time when its extension or BM25 indexes are absent.
-- Editing this shipped migration is safe: Drizzle only compares `created_at`, so databases
-- that already applied it never re-run it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_search') THEN
    CREATE EXTENSION IF NOT EXISTS pg_search;
  ELSE
    RAISE NOTICE 'pg_search is not available on this database; skipping BM25 search setup';
  END IF;
END $$;
