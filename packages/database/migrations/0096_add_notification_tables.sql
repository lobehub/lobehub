CREATE TABLE IF NOT EXISTS "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"provider_message_id" text,
	"failed_reason" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"dedupe_key" text,
	"action_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "notification" jsonb;--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_notification_id_notifications_id_fk";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deliveries_notification" ON "notification_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deliveries_channel" ON "notification_deliveries" USING btree ("channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deliveries_status" ON "notification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_active" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."is_archived" = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread" ON "notifications" USING btree ("user_id") WHERE "notifications"."is_read" = false AND "notifications"."is_archived" = false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_notifications_dedupe" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_archived_cleanup" ON "notifications" USING btree ("updated_at","created_at","id") WHERE "notifications"."is_archived" = true;
