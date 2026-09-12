ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "architecture" varchar(20);--> statement-breakpoint
COMMENT ON COLUMN "devices"."architecture" IS 'CPU architecture reported by the client (process.arch: x64 | arm64). NULL for devices that have not reported since this column landed; only a fresh client report fills it (no backfill).';--> statement-breakpoint
