-- Custom SQL migration file, put your code below! --
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_search;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Skipping pg_search extension: %', SQLERRM;
END $$;
