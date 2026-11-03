ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "avatar" text;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "background_color" text;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;
