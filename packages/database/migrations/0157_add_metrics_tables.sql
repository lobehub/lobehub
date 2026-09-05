CREATE TABLE IF NOT EXISTS "metric_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"value" numeric(20, 6) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"operation_id" text,
	"source_type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"key" text NOT NULL,
	"title" text,
	"kind" text DEFAULT 'gauge' NOT NULL,
	"unit" text,
	"config" jsonb,
	"metadata" jsonb,
	"deleted_at" timestamp with time zone,
	"is_deleted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_points" DROP CONSTRAINT IF EXISTS "metric_points_metric_id_metrics_id_fk";--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_metric_id_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_points" DROP CONSTRAINT IF EXISTS "metric_points_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_points" DROP CONSTRAINT IF EXISTS "metric_points_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" DROP CONSTRAINT IF EXISTS "metrics_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_series_time_idx" ON "metric_points" USING btree ("metric_id","observed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_user_id_idx" ON "metric_points" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_points_workspace_id_idx" ON "metric_points" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "metrics_subject_key_unique" ON "metrics" USING btree ("subject_type","subject_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_user_id_idx" ON "metrics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metrics_workspace_id_idx" ON "metrics" USING btree ("workspace_id");