ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp with time zone;
