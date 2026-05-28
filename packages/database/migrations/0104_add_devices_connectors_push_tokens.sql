CREATE TABLE IF NOT EXISTS "user_connector_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_connector_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"description" text,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"crud_type" text NOT NULL,
	"render_config" jsonb,
	"permission" text NOT NULL,
	"is_work_artifact" boolean DEFAULT false NOT NULL,
	"work_artifact_config" jsonb,
	"limit_config" jsonb,
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"identity_source" varchar(20) NOT NULL,
	"hostname" text,
	"platform" varchar(20),
	"friendly_name" text,
	"default_cwd" text,
	"recent_cwds" text[] DEFAULT '{}' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"permission" text DEFAULT 'read' NOT NULL,
	"page_view_count" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"expo_token" text NOT NULL,
	"device_id" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_cost" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "cost" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "usage" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "user_connector_tools" DROP CONSTRAINT IF EXISTS "user_connector_tools_user_connector_id_user_connectors_id_fk";--> statement-breakpoint
ALTER TABLE "user_connector_tools" ADD CONSTRAINT "user_connector_tools_user_connector_id_user_connectors_id_fk" FOREIGN KEY ("user_connector_id") REFERENCES "public"."user_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connector_tools" DROP CONSTRAINT IF EXISTS "user_connector_tools_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_connector_tools" ADD CONSTRAINT "user_connector_tools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connectors" DROP CONSTRAINT IF EXISTS "user_connectors_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_connectors" ADD CONSTRAINT "user_connectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" DROP CONSTRAINT IF EXISTS "document_shares_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" DROP CONSTRAINT IF EXISTS "push_tokens_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_connector_tools_connector_tool_unique" ON "user_connector_tools" USING btree ("user_connector_id","tool_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connector_tools_user_id_idx" ON "user_connector_tools" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connector_tools_connector_id_idx" ON "user_connector_tools" USING btree ("user_connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_connectors_user_identifier_unique" ON "user_connectors" USING btree ("user_id","identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_user_id_idx" ON "user_connectors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connectors_token_expires_at_idx" ON "user_connectors" USING btree ("token_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_user_id_device_id_unique" ON "devices" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_user_id_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_shares_document_id_unique" ON "document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_shares_user_id_idx" ON "document_shares" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_tokens_user_device" ON "push_tokens" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_user" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_last_seen" ON "push_tokens" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_model_idx" ON "topics" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_provider_idx" ON "topics" USING btree ("provider");
