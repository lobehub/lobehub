CREATE TABLE IF NOT EXISTS "user_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"source_type" text NOT NULL,
	"mcp_server_url" text,
	"mcp_connection_type" text,
	"mcp_stdio_config" jsonb,
	"status" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"oidc_config" jsonb,
	"credentials" text,
	"token_expires_at" timestamp with time zone,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_connector_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_connector_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"description" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"category" text NOT NULL,
	"permission" text NOT NULL,
	"is_work_artifact" boolean DEFAULT false NOT NULL,
	"work_artifact_config" jsonb,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_connectors" DROP CONSTRAINT IF EXISTS "user_connectors_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_connectors" ADD CONSTRAINT "user_connectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connector_tools" DROP CONSTRAINT IF EXISTS "user_connector_tools_user_connector_id_user_connectors_id_fk";--> statement-breakpoint
ALTER TABLE "user_connector_tools" ADD CONSTRAINT "user_connector_tools_user_connector_id_user_connectors_id_fk" FOREIGN KEY ("user_connector_id") REFERENCES "public"."user_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connector_tools" DROP CONSTRAINT IF EXISTS "user_connector_tools_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_connector_tools" ADD CONSTRAINT "user_connector_tools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_connectors_user_identifier_unique" ON "user_connectors" USING btree ("user_id","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_user_id_idx" ON "user_connectors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_token_expires_at_idx" ON "user_connectors" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_connector_tools_connector_tool_unique" ON "user_connector_tools" USING btree ("user_connector_id","tool_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connector_tools_user_id_idx" ON "user_connector_tools" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connector_tools_connector_id_idx" ON "user_connector_tools" USING btree ("user_connector_id");