ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen_reason" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "frozen_at" timestamp with time zone;
