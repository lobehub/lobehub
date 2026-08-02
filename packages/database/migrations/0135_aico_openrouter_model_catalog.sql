CREATE TABLE IF NOT EXISTS "openrouter_model_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"type" varchar(20) DEFAULT 'chat' NOT NULL,
	"context_window_tokens" integer,
	"pricing" jsonb,
	"abilities" jsonb DEFAULT '{}'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"released_at" varchar(10),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "openrouter_model_sync_state" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_status" text DEFAULT 'never' NOT NULL,
	"last_error" text,
	"model_count" integer DEFAULT 0 NOT NULL,
	"last_triggered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "openrouter_model_catalog_enabled_idx" ON "openrouter_model_catalog" USING btree ("enabled");
