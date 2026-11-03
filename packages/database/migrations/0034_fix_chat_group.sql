ALTER TABLE "messages" ALTER COLUMN "role" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "chat_groups" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "chat_groups" DROP CONSTRAINT IF EXISTS "chat_groups_group_id_session_groups_id_fk";--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_group_id_session_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."session_groups"("id") ON DELETE set null ON UPDATE no action;
