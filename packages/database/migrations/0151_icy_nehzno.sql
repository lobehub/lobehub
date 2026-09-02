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
ALTER TABLE "user_execution_policies" ADD CONSTRAINT "user_execution_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;