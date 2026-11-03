CREATE TABLE IF NOT EXISTS "agent_cron_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"group_id" text,
	"user_id" text NOT NULL,
	"name" text,
	"description" text,
	"enabled" boolean DEFAULT true,
	"cron_pattern" text NOT NULL,
	"timezone" text DEFAULT 'UTC',
	"content" text NOT NULL,
	"edit_data" jsonb,
	"max_executions" integer,
	"remaining_executions" integer,
	"execution_conditions" jsonb,
	"last_executed_at" timestamp,
	"total_executions" integer DEFAULT 0,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "trigger" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "mode" text;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'agent_cron_jobs_agent_id_agents_id_fk'
    ) THEN
        ALTER TABLE "agent_cron_jobs" ADD CONSTRAINT "agent_cron_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'agent_cron_jobs_group_id_chat_groups_id_fk'
    ) THEN
        ALTER TABLE "agent_cron_jobs" ADD CONSTRAINT "agent_cron_jobs_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'agent_cron_jobs_user_id_users_id_fk'
    ) THEN
        ALTER TABLE "agent_cron_jobs" ADD CONSTRAINT "agent_cron_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_agent_id_idx" ON "agent_cron_jobs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_group_id_idx" ON "agent_cron_jobs" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_user_id_idx" ON "agent_cron_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_enabled_idx" ON "agent_cron_jobs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_remaining_executions_idx" ON "agent_cron_jobs" USING btree ("remaining_executions");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_cron_jobs_last_executed_at_idx" ON "agent_cron_jobs" USING btree ("last_executed_at");