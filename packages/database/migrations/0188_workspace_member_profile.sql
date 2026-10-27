ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "title" text;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN IF NOT EXISTS "responsibilities" text;