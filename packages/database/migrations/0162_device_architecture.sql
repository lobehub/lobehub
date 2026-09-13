ALTER TABLE "devices" ADD COLUMN "architecture" varchar(20);--> statement-breakpoint
COMMENT ON COLUMN "devices"."architecture" IS 'CPU architecture reported by the client (process.arch: x64 | arm64). NULL for devices that have not reported since this column landed; only a fresh client report fills it (no backfill).';--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
COMMENT ON COLUMN "devices"."metadata" IS 'Extensible client-reported device info bag (app version, electron/chrome/node versions, host OS release). Keys are non-contractual; always nullable.';--> statement-breakpoint
