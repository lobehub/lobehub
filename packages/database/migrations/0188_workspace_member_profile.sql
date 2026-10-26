ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "job_title" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "responsibilities" text;