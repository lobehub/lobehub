CREATE TABLE IF NOT EXISTS "scm_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"repo_full_name" varchar(255) NOT NULL,
	"repo_external_id" varchar(255),
	"number" integer NOT NULL,
	"external_id" varchar(255),
	"url" text NOT NULL,
	"title" text,
	"author_external_id" varchar(255),
	"author_external_login" varchar(255),
	"head_ref" varchar(255),
	"head_sha" varchar(255),
	"base_ref" varchar(255),
	"is_draft" boolean DEFAULT false NOT NULL,
	"state" text NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"merged_by_external_id" varchar(255),
	"ci_status" text,
	"ci_head_sha" varchar(255),
	"checks" jsonb,
	"review_decision" text,
	"merge_state_status" varchar(255),
	"installation_id" uuid,
	"acceptance_id" uuid,
	"work_id" text,
	"topic_id" text,
	"task_id" text,
	"wake_count" integer DEFAULT 0 NOT NULL,
	"last_wake_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_event_kind" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_user_id" varchar(255) NOT NULL,
	"external_login" varchar(255) NOT NULL,
	"credentials" text,
	"token_expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"provider" text NOT NULL,
	"installation_id" varchar(255) NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_external_id" varchar(255) NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"repositories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"installed_by_external_user_id" varchar(255),
	"installed_by_external_login" varchar(255),
	"suspended_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scm_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"delivery_id" varchar(255) NOT NULL,
	"event" varchar(255) NOT NULL,
	"action" varchar(255),
	"installation_id" varchar(255),
	"repo_full_name" varchar(255),
	"number" integer,
	"status" text NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_installation_id_scm_installations_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_installation_id_scm_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."scm_installations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_acceptance_id_acceptances_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_work_id_works_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_change_requests" DROP CONSTRAINT IF EXISTS "scm_change_requests_task_id_tasks_id_fk";--> statement-breakpoint
ALTER TABLE "scm_change_requests" ADD CONSTRAINT "scm_change_requests_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_identities" DROP CONSTRAINT IF EXISTS "scm_identities_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "scm_identities" ADD CONSTRAINT "scm_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_installations" DROP CONSTRAINT IF EXISTS "scm_installations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "scm_installations" ADD CONSTRAINT "scm_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scm_installations" DROP CONSTRAINT IF EXISTS "scm_installations_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "scm_installations" ADD CONSTRAINT "scm_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scm_change_requests_provider_repo_number_unique" ON "scm_change_requests" USING btree ("provider","repo_full_name","number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_acceptance_id_idx" ON "scm_change_requests" USING btree ("acceptance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_topic_id_idx" ON "scm_change_requests" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_work_id_idx" ON "scm_change_requests" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_installation_id_idx" ON "scm_change_requests" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_user_updated_at_idx" ON "scm_change_requests" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_workspace_id_idx" ON "scm_change_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_change_requests_head_sha_idx" ON "scm_change_requests" USING btree ("head_sha");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scm_identities_provider_external_user_unique" ON "scm_identities" USING btree ("provider","external_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scm_identities_provider_user_unique" ON "scm_identities" USING btree ("provider","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_identities_token_expires_at_idx" ON "scm_identities" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scm_installations_provider_installation_unique" ON "scm_installations" USING btree ("provider","installation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_installations_user_id_idx" ON "scm_installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_installations_workspace_id_idx" ON "scm_installations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_installations_provider_account_idx" ON "scm_installations" USING btree ("provider","account_login");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scm_webhook_deliveries_provider_delivery_unique" ON "scm_webhook_deliveries" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scm_webhook_deliveries_received_at_idx" ON "scm_webhook_deliveries" USING btree ("received_at");