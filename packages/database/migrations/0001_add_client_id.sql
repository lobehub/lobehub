ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "session_groups" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_client_id_idx" ON "messages" ("client_id");--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_client_id_unique";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "session_groups" DROP CONSTRAINT IF EXISTS "session_groups_client_id_unique";--> statement-breakpoint
ALTER TABLE "session_groups" ADD CONSTRAINT "session_groups_client_id_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_client_id_unique";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT IF EXISTS "topics_client_id_unique";--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_client_id_unique" UNIQUE("client_id");
