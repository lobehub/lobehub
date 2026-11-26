CREATE TABLE IF NOT EXISTS "message_context_snapshots" (
	"message_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_context_snapshots" DROP CONSTRAINT IF EXISTS "message_context_snapshots_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "message_context_snapshots" ADD CONSTRAINT "message_context_snapshots_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_context_snapshots" DROP CONSTRAINT IF EXISTS "message_context_snapshots_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "message_context_snapshots" ADD CONSTRAINT "message_context_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_context_snapshots" DROP CONSTRAINT IF EXISTS "message_context_snapshots_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "message_context_snapshots" ADD CONSTRAINT "message_context_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;