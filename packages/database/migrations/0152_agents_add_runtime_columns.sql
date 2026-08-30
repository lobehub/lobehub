ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "runtime_kind" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "runtime_type" text;
