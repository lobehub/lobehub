CREATE INDEX IF NOT EXISTS "topics_extract_status_gin_idx" ON "topics" USING gin ((metadata->'userMemoryExtractStatus') jsonb_path_ops);
