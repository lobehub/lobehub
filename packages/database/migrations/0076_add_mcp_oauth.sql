CREATE TABLE IF NOT EXISTS "mcp_oauth_pending" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plugin_identifier" text NOT NULL,
	"mcp_url" text NOT NULL,
	"code_verifier" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"metadata" jsonb,
	"client_id" text,
	"token_endpoint" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_oauth_tokens" (
	"user_id" text NOT NULL,
	"plugin_identifier" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"token_endpoint" text NOT NULL,
	"client_id" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_tokens_user_id_plugin_identifier_pk" PRIMARY KEY("user_id","plugin_identifier")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_pending" ADD CONSTRAINT "mcp_oauth_pending_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_pending_user_id_expires_at_idx" ON "mcp_oauth_pending" ("user_id","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_tokens_user_id_idx" ON "mcp_oauth_tokens" ("user_id");
