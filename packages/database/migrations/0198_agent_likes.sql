CREATE TABLE IF NOT EXISTS "agent_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_likes" DROP CONSTRAINT IF EXISTS "agent_likes_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_likes" ADD CONSTRAINT "agent_likes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_likes" DROP CONSTRAINT IF EXISTS "agent_likes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_likes" ADD CONSTRAINT "agent_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_likes" DROP CONSTRAINT IF EXISTS "agent_likes_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_likes" ADD CONSTRAINT "agent_likes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_likes_agent_id_user_id_unique" ON "agent_likes" USING btree ("agent_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_likes_user_id_idx" ON "agent_likes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_likes_workspace_id_idx" ON "agent_likes" USING btree ("workspace_id");