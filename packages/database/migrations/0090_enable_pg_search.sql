-- Custom SQL migration file, put your code below! --
-- pg_search (ParadeDB) is unavailable on some managed providers (e.g. new Neon
-- projects, where it was deprecated on 2026-03-19). Install it when the
-- platform provides it; otherwise skip so fresh databases can still migrate.
-- Deployments without the extension must set FTS_SEARCH_PROVIDER=pg_like.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_search;
EXCEPTION
  WHEN insufficient_privilege OR feature_not_supported OR undefined_object THEN
    RAISE NOTICE 'pg_search extension is unavailable on this database, skipping: %', SQLERRM;
END $$;
