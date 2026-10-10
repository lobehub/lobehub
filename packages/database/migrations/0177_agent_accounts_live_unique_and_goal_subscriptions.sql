CREATE TABLE IF NOT EXISTS "goal_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" text NOT NULL,
	"widget_id" uuid NOT NULL,
	"metric_id" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"confirmed_version_id" uuid NOT NULL,
	"binding_revision" integer DEFAULT 1 NOT NULL,
	"binding" jsonb NOT NULL,
	"wake_condition" jsonb NOT NULL,
	"freshness_policy" jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_subscriptions_binding_revision_positive" CHECK ("goal_subscriptions"."binding_revision" > 0)
);
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_accounts_agent_kind_provider_identifier_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "agent_accounts_provider_identifier_unique";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" DROP CONSTRAINT IF EXISTS "goal_subscriptions_goal_id_goals_id_fk";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" ADD CONSTRAINT "goal_subscriptions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subscriptions" DROP CONSTRAINT IF EXISTS "goal_subscriptions_widget_id_widgets_id_fk";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" ADD CONSTRAINT "goal_subscriptions_widget_id_widgets_id_fk" FOREIGN KEY ("widget_id") REFERENCES "public"."widgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subscriptions" DROP CONSTRAINT IF EXISTS "goal_subscriptions_metric_id_metrics_id_fk";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" ADD CONSTRAINT "goal_subscriptions_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subscriptions" DROP CONSTRAINT IF EXISTS "goal_subscriptions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" ADD CONSTRAINT "goal_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subscriptions" DROP CONSTRAINT IF EXISTS "goal_subscriptions_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" ADD CONSTRAINT "goal_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subscriptions" DROP CONSTRAINT IF EXISTS "goal_subscriptions_confirmed_version_id_widget_versions_id_fk";--> statement-breakpoint
ALTER TABLE "goal_subscriptions" ADD CONSTRAINT "goal_subscriptions_confirmed_version_id_widget_versions_id_fk" FOREIGN KEY ("confirmed_version_id") REFERENCES "public"."widget_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_subscriptions_goal_widget_metric_unique" ON "goal_subscriptions" USING btree ("goal_id","widget_id","metric_id") WHERE "goal_subscriptions"."metric_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_subscriptions_goal_widget_result_unique" ON "goal_subscriptions" USING btree ("goal_id","widget_id") WHERE "goal_subscriptions"."metric_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_subscriptions_widget_enabled_idx" ON "goal_subscriptions" USING btree ("widget_id","workspace_id","user_id") WHERE "goal_subscriptions"."enabled" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_subscriptions_personal_idx" ON "goal_subscriptions" USING btree ("user_id","goal_id") WHERE "goal_subscriptions"."workspace_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_subscriptions_workspace_idx" ON "goal_subscriptions" USING btree ("workspace_id","goal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_subscriptions_metric_id_idx" ON "goal_subscriptions" USING btree ("metric_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_subscriptions_confirmed_version_id_idx" ON "goal_subscriptions" USING btree ("confirmed_version_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_subscriptions_reconcile_idx" ON "goal_subscriptions" USING btree ("updated_at","id") WHERE "goal_subscriptions"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_accounts_agent_kind_provider_identifier_unique" ON "agent_accounts" USING btree ("agent_id","kind","provider","identifier") WHERE "agent_accounts"."status" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_accounts_provider_identifier_unique" ON "agent_accounts" USING btree ("provider","identifier") WHERE "agent_accounts"."status" <> 'revoked';