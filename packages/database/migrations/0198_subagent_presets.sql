CREATE TABLE IF NOT EXISTS "subagents" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_agent_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_role" text,
	"model" text,
	"provider" text,
	"reasoning_effort" text,
	"tools" jsonb,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "subagent_id" text;--> statement-breakpoint
ALTER TABLE "subagents" DROP CONSTRAINT IF EXISTS "subagents_parent_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "subagents" ADD CONSTRAINT "subagents_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subagents_parent_agent_id_idx" ON "subagents" USING btree ("parent_agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subagents_parent_agent_id_name_unique" ON "subagents" USING btree ("parent_agent_id","name");--> statement-breakpoint
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_subagent_id_subagents_id_fk";--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_subagent_id_subagents_id_fk" FOREIGN KEY ("subagent_id") REFERENCES "public"."subagents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "threads_subagent_id_idx" ON "threads" USING btree ("subagent_id");