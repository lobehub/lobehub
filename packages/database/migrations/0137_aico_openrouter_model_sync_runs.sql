CREATE TABLE IF NOT EXISTS "openrouter_model_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"triggered_by" text,
	"model_count" integer DEFAULT 0 NOT NULL,
	"added_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"removed_model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"synced_at" timestamptz NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "openrouter_model_sync_runs_synced_at_idx" ON "openrouter_model_sync_runs" USING btree ("synced_at");
