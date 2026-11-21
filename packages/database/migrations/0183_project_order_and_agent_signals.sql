CREATE TABLE IF NOT EXISTS "agent_inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"account_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"title" text,
	"preview" text,
	"thread_key" text,
	"received_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"topic_id" text,
	"wake_claimed_at" timestamp with time zone,
	"wait_consumed_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"account_id" uuid NOT NULL,
	"signal_id" uuid,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"message_id" text,
	"in_reply_to" text,
	"references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thread_key" text,
	"from_address" text NOT NULL,
	"from_name" text,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text,
	"text" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivered_at" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"account_id" uuid,
	"agent_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"occurred_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "identifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sort_order" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_account_id_agent_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_inbox_messages" ADD CONSTRAINT "agent_inbox_messages_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_mails" ADD CONSTRAINT "agent_mails_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_mails" ADD CONSTRAINT "agent_mails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_mails" ADD CONSTRAINT "agent_mails_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_mails" ADD CONSTRAINT "agent_mails_account_id_agent_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_mails" ADD CONSTRAINT "agent_mails_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signals" ADD CONSTRAINT "signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signals" ADD CONSTRAINT "signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signals" ADD CONSTRAINT "signals_account_id_agent_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signals" ADD CONSTRAINT "signals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_inbox_messages_source_unique" ON "agent_inbox_messages" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_agent_received_at_idx" ON "agent_inbox_messages" USING btree ("agent_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_agent_created_at_idx" ON "agent_inbox_messages" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_account_created_at_idx" ON "agent_inbox_messages" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_account_sender_created_at_idx" ON "agent_inbox_messages" USING btree ("account_id","sender","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_account_thread_idx" ON "agent_inbox_messages" USING btree ("account_id","thread_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_inbox_messages_user_id_idx" ON "agent_inbox_messages" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_mails_account_provider_message_unique" ON "agent_mails" USING btree ("account_id","provider_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_account_thread_idx" ON "agent_mails" USING btree ("account_id","thread_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_agent_delivered_at_idx" ON "agent_mails" USING btree ("agent_id","delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_signal_id_idx" ON "agent_mails" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_mails_user_id_idx" ON "agent_mails" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signals_source_external_id_unique" ON "signals" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_status_created_at_idx" ON "signals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_account_created_at_idx" ON "signals" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_user_id_idx" ON "signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_user_id_sort_order_idx" ON "projects" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_workspace_id_sort_order_idx" ON "projects" USING btree ("workspace_id","sort_order");
