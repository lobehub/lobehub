-- Migration to apply specific autovacuum settings to high-traffic tables
-- This is crucial to prevent table and TOAST bloat for 'embeddings' and 'chunks'
-- https://github.com/lobehub/lobe-chat/issues/8316

-- Tuning for the 'embeddings' table
-- Default scale factor (0.2) is too high, leading to infrequent vacuuming.
-- Lowering to 2% to ensure frequent cleanup.
ALTER TABLE "embeddings" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);

--> statement-breakpoint

-- Tuning for the 'chunks' table
-- This table also experiences many updates/deletes and requires similar tuning.
ALTER TABLE "chunks" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 1000);
