CREATE TABLE IF NOT EXISTS "agent_bot_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"platform" varchar(50) NOT NULL,
	"application_id" varchar(255) NOT NULL,
	"credentials" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_eval_benchmarks_identifier_unique";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "agency_config" jsonb;--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "agent_bot_providers" DROP CONSTRAINT IF EXISTS "agent_bot_providers_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_bot_providers" ADD CONSTRAINT "agent_bot_providers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bot_providers" DROP CONSTRAINT IF EXISTS "agent_bot_providers_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_bot_providers" ADD CONSTRAINT "agent_bot_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_bot_providers_platform_app_id_unique" ON "agent_bot_providers" USING btree ("platform","application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bot_providers_platform_idx" ON "agent_bot_providers" USING btree ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bot_providers_agent_id_idx" ON "agent_bot_providers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bot_providers_user_id_idx" ON "agent_bot_providers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" DROP CONSTRAINT IF EXISTS "agent_eval_benchmarks_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_eval_benchmarks" ADD CONSTRAINT "agent_eval_benchmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_benchmarks_identifier_user_id_unique" ON "agent_eval_benchmarks" USING btree ("identifier","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_eval_benchmarks_user_id_idx" ON "agent_eval_benchmarks" USING btree ("user_id");