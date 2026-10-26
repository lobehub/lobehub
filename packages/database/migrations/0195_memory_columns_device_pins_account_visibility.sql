-- Structured user memory columns on the existing user_memories* tables (lifecycle, context
-- synthesis, dossier and entity links), per-device agent account pins, and workspace visibility for
-- subscription accounts. The new memory tables themselves landed in 0193.
-- Every change to an existing table is additive and nullable (or has a constant default).
-- Foreign keys on the existing large memory tables are NOT VALID: the new columns are all NULL, so
-- validation would only scan the table under lock. Run VALIDATE CONSTRAINT later if wanted.
CREATE TABLE IF NOT EXISTS "agent_account_device_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"device_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "agent_provider_accounts" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "state" text;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "user_locked" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD COLUMN IF NOT EXISTS "dossier_id" varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD COLUMN IF NOT EXISTS "injectable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "user_memory_id" varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "now" text;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "next_steps" jsonb;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "open_questions" jsonb;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "last_evidence_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "synthesized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "entity_id" varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "holder_entity_id" varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "applies_to_entity_id" varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "scope" text;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "evidence_source" text;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "evidence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "last_evidence_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" DROP CONSTRAINT IF EXISTS "agent_account_device_pins_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" ADD CONSTRAINT "agent_account_device_pins_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" DROP CONSTRAINT IF EXISTS "agent_account_device_pins_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" ADD CONSTRAINT "agent_account_device_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" DROP CONSTRAINT IF EXISTS "agent_account_device_pins_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" ADD CONSTRAINT "agent_account_device_pins_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" DROP CONSTRAINT IF EXISTS "agent_account_device_pins_device_id_devices_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" ADD CONSTRAINT "agent_account_device_pins_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" DROP CONSTRAINT IF EXISTS "agent_account_device_pins_account_id_agent_provider_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "agent_account_device_pins" ADD CONSTRAINT "agent_account_device_pins_account_id_agent_provider_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."agent_provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_account_device_pins_agent_device_unique" ON "agent_account_device_pins" USING btree ("agent_id","device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_device_pins_device_id_idx" ON "agent_account_device_pins" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_device_pins_account_id_idx" ON "agent_account_device_pins" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_device_pins_user_id_idx" ON "agent_account_device_pins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_account_device_pins_workspace_id_idx" ON "agent_account_device_pins" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "user_memories_activities" DROP CONSTRAINT IF EXISTS "user_memories_activities_dossier_id_user_memories_dossiers_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD CONSTRAINT "user_memories_activities_dossier_id_user_memories_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."user_memories_dossiers"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" DROP CONSTRAINT IF EXISTS "user_memories_contexts_user_memory_id_user_memories_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD CONSTRAINT "user_memories_contexts_user_memory_id_user_memories_id_fk" FOREIGN KEY ("user_memory_id") REFERENCES "public"."user_memories"("id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP CONSTRAINT IF EXISTS "user_memories_identities_entity_id_user_memories_entities_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD CONSTRAINT "user_memories_identities_entity_id_user_memories_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."user_memories_entities"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP CONSTRAINT IF EXISTS "user_memories_preferences_holder_entity_id_user_memories_entities_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_holder_entity_id_user_memories_entities_id_fk" FOREIGN KEY ("holder_entity_id") REFERENCES "public"."user_memories_entities"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP CONSTRAINT IF EXISTS "user_memories_preferences_applies_to_entity_id_user_memories_entities_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_applies_to_entity_id_user_memories_entities_id_fk" FOREIGN KEY ("applies_to_entity_id") REFERENCES "public"."user_memories_entities"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_provider_accounts_workspace_visibility_idx" ON "agent_provider_accounts" USING btree ("workspace_id","visibility","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_dossier_id_index" ON "user_memories_activities" USING btree ("dossier_id") WHERE "user_memories_activities"."dossier_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_memory_id_index" ON "user_memories_contexts" USING btree ("user_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_id_last_evidence_at_index" ON "user_memories_contexts" USING btree ("user_id","last_evidence_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_identities_entity_id_index" ON "user_memories_identities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_holder_entity_id_index" ON "user_memories_preferences" USING btree ("holder_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_preferences_applies_to_entity_id_index" ON "user_memories_preferences" USING btree ("applies_to_entity_id");
