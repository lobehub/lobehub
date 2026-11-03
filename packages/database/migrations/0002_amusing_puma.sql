ALTER TABLE "messages" DROP CONSTRAINT "messages_client_id_unique";--> statement-breakpoint
ALTER TABLE "session_groups" DROP CONSTRAINT "session_groups_client_id_unique";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_client_id_unique";--> statement-breakpoint
ALTER TABLE "topics" DROP CONSTRAINT "topics_client_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "messages_client_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_client_id_user_unique" ON "messages" ("client_id","user_id");--> statement-breakpoint
ALTER TABLE "session_groups" ADD CONSTRAINT "session_group_client_id_user_unique" UNIQUE("client_id","user_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_client_id_user_id_unique" UNIQUE("client_id","user_id");--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topic_client_id_user_id_unique" UNIQUE("client_id","user_id");