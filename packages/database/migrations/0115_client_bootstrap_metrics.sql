CREATE TABLE IF NOT EXISTS "client_bootstrap_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_version" text NOT NULL,
	"platform" varchar NOT NULL,
	"is_login" boolean NOT NULL,
	"cold" boolean NOT NULL,
	"total_ms" integer NOT NULL,
	"user_id" text,
	"anon_id" text,
	"browser" text,
	"os" text,
	"country" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_bootstrap_spans" (
	"id" text PRIMARY KEY NOT NULL,
	"metric_id" text NOT NULL,
	"name" text NOT NULL,
	"start_ms" integer NOT NULL,
	"dur_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_bootstrap_spans" DROP CONSTRAINT IF EXISTS "client_bootstrap_spans_metric_id_client_bootstrap_metrics_id_fk";--> statement-breakpoint
ALTER TABLE "client_bootstrap_spans" ADD CONSTRAINT "client_bootstrap_spans_metric_id_client_bootstrap_metrics_id_fk" FOREIGN KEY ("metric_id") REFERENCES "public"."client_bootstrap_metrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bootstrap_metrics_version_created" ON "client_bootstrap_metrics" USING btree ("app_version","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bootstrap_metrics_platform_created" ON "client_bootstrap_metrics" USING btree ("platform","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bootstrap_metrics_created" ON "client_bootstrap_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bootstrap_metrics_cold_created" ON "client_bootstrap_metrics" USING btree ("cold","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bootstrap_spans_metric" ON "client_bootstrap_spans" USING btree ("metric_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bootstrap_spans_name" ON "client_bootstrap_spans" USING btree ("name");
