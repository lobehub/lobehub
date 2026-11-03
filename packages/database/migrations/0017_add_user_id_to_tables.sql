-- Complete User ID Migration Script
-- Includes adding columns to all tables, populating data, and setting constraints

BEGIN;--> statement-breakpoint

CREATE INDEX "file_hash_idx" ON "files" USING btree ("file_hash");--> statement-breakpoint

-- Step 1: Add nullable user_id columns to all required tables
ALTER TABLE "global_files" ADD COLUMN IF NOT EXISTS "creator" text;--> statement-breakpoint
ALTER TABLE "knowledge_base_files" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "message_chunks" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "message_plugins" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "message_queries" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "message_query_chunks" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "message_tts" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "message_translates" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "messages_files" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "agents_to_sessions" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "file_chunks" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "files_to_sessions" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint

-- Step 2: Populate user_id fields
-- Retrieve user_id from associated tables

-- Populate user_id for knowledge_base_files
UPDATE "knowledge_base_files" AS kbf
SET "user_id" = kb."user_id"
  FROM "knowledge_bases" AS kb
WHERE kbf."knowledge_base_id" = kb."id";--> statement-breakpoint

-- Populate user_id for message_chunks
UPDATE "message_chunks" AS mc
SET "user_id" = m."user_id"
  FROM "messages" AS m
WHERE mc."message_id" = m."id";--> statement-breakpoint

-- Populate user_id for message_plugins (directly from messages table)
UPDATE "message_plugins" AS mp
SET "user_id" = m."user_id"
  FROM "messages" AS m
WHERE mp."id" = m."id";--> statement-breakpoint

-- Populate user_id for message_queries
UPDATE "message_queries" AS mq
SET "user_id" = m."user_id"
  FROM "messages" AS m
WHERE mq."message_id" = m."id";--> statement-breakpoint

-- Populate user_id for message_query_chunks
UPDATE "message_query_chunks" AS mqc
SET "user_id" = mq."user_id"
  FROM "message_queries" AS mq
WHERE mqc."query_id" = mq."id";--> statement-breakpoint

-- Populate user_id for message_tts
UPDATE "message_tts" AS mt
SET "user_id" = m."user_id"
  FROM "messages" AS m
WHERE mt."id" = m."id";--> statement-breakpoint

-- Populate user_id for message_translates
UPDATE "message_translates" AS mt
SET "user_id" = m."user_id"
  FROM "messages" AS m
WHERE mt."id" = m."id";--> statement-breakpoint

-- Populate user_id for messages_files
UPDATE "messages_files" AS mf
SET "user_id" = m."user_id"
  FROM "messages" AS m
WHERE mf."message_id" = m."id";--> statement-breakpoint

-- Populate creator for global_files (get the first user who created the file from files table)
UPDATE "global_files" AS gf
SET "creator" = (
  SELECT f."user_id"
  FROM "files" AS f
  WHERE f."file_hash" = gf."hash_id"
  ORDER BY f."created_at" ASC
  LIMIT 1
  );--> statement-breakpoint

-- Delete global_files records where no user has used the file in the files table
DELETE FROM "global_files"
WHERE "creator" IS NULL;--> statement-breakpoint

-- Populate user_id for agents_to_sessions
UPDATE "agents_to_sessions" AS ats
SET "user_id" = a."user_id"
  FROM "agents" AS a
WHERE ats."agent_id" = a."id";--> statement-breakpoint

-- Populate user_id for file_chunks
UPDATE "file_chunks" AS fc
SET "user_id" = f."user_id"
  FROM "files" AS f
WHERE fc."file_id" = f."id";--> statement-breakpoint

-- Populate user_id for files_to_sessions
UPDATE "files_to_sessions" AS fts
SET "user_id" = f."user_id"
  FROM "files" AS f
WHERE fts."file_id" = f."id";--> statement-breakpoint

-- Get user_id from sessions table (handle potential NULL values)
UPDATE "files_to_sessions" AS fts
SET "user_id" = s."user_id"
  FROM "sessions" AS s
WHERE fts."session_id" = s."id" AND fts."user_id" IS NULL;--> statement-breakpoint

UPDATE "agents_to_sessions" AS ats
SET "user_id" = s."user_id"
  FROM "sessions" AS s
WHERE ats."session_id" = s."id" AND ats."user_id" IS NULL;--> statement-breakpoint

-- Step 3: Check for any unpopulated records
DO $$
DECLARE
kb_files_count INTEGER;
    msg_chunks_count INTEGER;
    msg_plugins_count INTEGER;
    msg_queries_count INTEGER;
    msg_query_chunks_count INTEGER;
    msg_tts_count INTEGER;
    msg_translates_count INTEGER;
    msgs_files_count INTEGER;
    agents_sessions_count INTEGER;
    file_chunks_count INTEGER;
    files_sessions_count INTEGER;
BEGIN
SELECT COUNT(*) INTO kb_files_count FROM "knowledge_base_files" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msg_chunks_count FROM "message_chunks" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msg_plugins_count FROM "message_plugins" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msg_queries_count FROM "message_queries" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msg_query_chunks_count FROM "message_query_chunks" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msg_tts_count FROM "message_tts" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msg_translates_count FROM "message_translates" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO msgs_files_count FROM "messages_files" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO agents_sessions_count FROM "agents_to_sessions" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO file_chunks_count FROM "file_chunks" WHERE "user_id" IS NULL;
SELECT COUNT(*) INTO files_sessions_count FROM "files_to_sessions" WHERE "user_id" IS NULL;

IF kb_files_count > 0 OR msg_chunks_count > 0 OR msg_plugins_count > 0 OR
       msg_queries_count > 0 OR msg_query_chunks_count > 0 OR msg_tts_count > 0 OR
       msg_translates_count > 0 OR msgs_files_count > 0 OR agents_sessions_count > 0 OR
       file_chunks_count > 0 OR files_sessions_count > 0 THEN
        RAISE EXCEPTION 'There are records with NULL user_id values that could not be populated';
END IF;
END $$;--> statement-breakpoint

-- Step 4: Add NOT NULL constraints and foreign keys
ALTER TABLE "knowledge_base_files" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_chunks" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_plugins" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_queries" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_query_chunks" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_tts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "message_translates" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages_files" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents_to_sessions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "file_chunks" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "files_to_sessions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- Add foreign key constraints
ALTER TABLE "global_files"
  ADD CONSTRAINT "global_files_creator_users_id_fk"
    FOREIGN KEY ("creator") REFERENCES "public"."users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "knowledge_base_files"
  ADD CONSTRAINT "knowledge_base_files_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "message_chunks"
  ADD CONSTRAINT "message_chunks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "message_plugins"
  ADD CONSTRAINT "message_plugins_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "message_queries"
  ADD CONSTRAINT "message_queries_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "message_query_chunks"
  ADD CONSTRAINT "message_query_chunks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "message_tts"
  ADD CONSTRAINT "message_tts_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "message_translates"
  ADD CONSTRAINT "message_translates_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "messages_files"
  ADD CONSTRAINT "messages_files_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "agents_to_sessions"
  ADD CONSTRAINT "agents_to_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "file_chunks"
  ADD CONSTRAINT "file_chunks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

ALTER TABLE "files_to_sessions"
  ADD CONSTRAINT "files_to_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;--> statement-breakpoint

COMMIT;--> statement-breakpoint
