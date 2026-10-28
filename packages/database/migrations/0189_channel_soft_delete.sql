-- Channels and Channel threads join the shared recycle bin with the standard
-- `is_deleted` / `deleted_at` pair (see `schemas/trash.ts`).
ALTER TABLE "channel_threads" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
-- One live thread per root message: a trashed thread keeps its row until restore or purge.
DROP INDEX IF EXISTS "channel_threads_root_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_threads_root_unique" ON "channel_threads" USING btree ("channel_id","root_message_id") WHERE "channel_threads"."is_deleted" IS NOT TRUE;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "is_deleted" boolean;--> statement-breakpoint
-- Replace the channel-local `archived` flag; a channel already removed keeps its deleted state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'channels' AND column_name = 'archived'
  ) THEN
    UPDATE "channels" SET "is_deleted" = true, "deleted_at" = "updated_at" WHERE "archived" = true;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "channels" DROP COLUMN IF EXISTS "archived";
