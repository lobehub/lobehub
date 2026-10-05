CREATE TABLE IF NOT EXISTS "agent_inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"from" text NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"text" text NOT NULL,
	"thread_key" text,
	"codes" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"received_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_account_id_agent_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_inbox_messages_account_provider_message_unique" ON "agent_inbox_messages" USING btree ("account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_agent_received_at_idx" ON "agent_inbox_messages" USING btree ("agent_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_agent_created_at_idx" ON "agent_inbox_messages" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_account_thread_idx" ON "agent_inbox_messages" USING btree ("account_id","thread_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_user_id_idx" ON "agent_inbox_messages" USING btree ("user_id");