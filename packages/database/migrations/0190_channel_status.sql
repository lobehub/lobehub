-- Lifecycle state for channels, Threads and members. It is orthogonal to the recycle bin
-- (`is_deleted` / `deleted_at`): an archived channel or Thread is kept, a trashed one is purged.
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
-- Replace the member `active` flag; a member who already left keeps that state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'channel_members' AND column_name = 'active'
  ) THEN
    UPDATE "channel_members" SET "status" = 'left' WHERE "active" = false;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "channel_members" DROP COLUMN IF EXISTS "active";
