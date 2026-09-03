CREATE TABLE "command_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"execution_target" text NOT NULL,
	"device_id" text,
	"tool_identifier" text NOT NULL,
	"api_name" text NOT NULL,
	"command_text" text,
	"blocked" boolean NOT NULL,
	"matched_rule_id" uuid,
	"path" text,
	"policy_field" text,
	"success" boolean,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_governance_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pattern" text NOT NULL,
	"pattern_type" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"action" text DEFAULT 'deny' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_execution_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"writable_roots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"readable_roots" jsonb,
	"denied_write_roots" jsonb,
	"denied_read_roots" jsonb,
	"allow_network" boolean DEFAULT false NOT NULL,
	"allowed_network_domains" jsonb,
	"env_allowlist" jsonb,
	"command_mode" text DEFAULT 'sandbox' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_execution_policies_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "command_execution_logs" ADD CONSTRAINT "command_execution_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_execution_logs" ADD CONSTRAINT "command_execution_logs_matched_rule_id_command_governance_rules_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."command_governance_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_governance_rules" ADD CONSTRAINT "command_governance_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_execution_policies" ADD CONSTRAINT "user_execution_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "command_execution_logs_user_id_idx" ON "command_execution_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "command_execution_logs_created_at_idx" ON "command_execution_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "command_execution_logs_execution_target_idx" ON "command_execution_logs" USING btree ("execution_target");--> statement-breakpoint
CREATE INDEX "command_execution_logs_blocked_idx" ON "command_execution_logs" USING btree ("blocked");--> statement-breakpoint
CREATE INDEX "command_governance_rules_user_id_idx" ON "command_governance_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "command_governance_rules_user_id_enabled_idx" ON "command_governance_rules" USING btree ("user_id","enabled");