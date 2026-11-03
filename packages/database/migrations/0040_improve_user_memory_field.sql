ALTER TABLE "user_memories_preferences" DROP CONSTRAINT IF EXISTS "user_memories_preferences_context_id_user_memories_contexts_id_fk";
--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ALTER COLUMN "user_memory_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_identities" ALTER COLUMN "relationship" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories_identities" ALTER COLUMN "user_memory_id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_memories" ADD COLUMN  IF NOT EXISTS"tags" text[];--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD COLUMN IF NOT EXISTS "tags" text[];--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD COLUMN IF NOT EXISTS "tags" text[];--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "tags" text[];--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD COLUMN IF NOT EXISTS "episodic_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD COLUMN IF NOT EXISTS "tags" text[];--> statement-breakpoint
ALTER TABLE "user_memories_contexts" ADD CONSTRAINT "user_memories_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_experiences" ADD CONSTRAINT "user_memories_experiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_identities" ADD CONSTRAINT "user_memories_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_preferences" ADD CONSTRAINT "user_memories_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_contexts" DROP COLUMN IF EXISTS "labels";--> statement-breakpoint
ALTER TABLE "user_memories_contexts" DROP COLUMN IF EXISTS "extracted_labels";--> statement-breakpoint
ALTER TABLE "user_memories_experiences" DROP COLUMN IF EXISTS "labels";--> statement-breakpoint
ALTER TABLE "user_memories_experiences" DROP COLUMN IF EXISTS "extracted_labels";--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP COLUMN IF EXISTS "current_focuses";--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP COLUMN IF EXISTS "experience";--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP COLUMN IF EXISTS "extracted_labels";--> statement-breakpoint
ALTER TABLE "user_memories_identities" DROP COLUMN IF EXISTS "labels";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP COLUMN IF EXISTS "context_id";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP COLUMN IF EXISTS "labels";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP COLUMN IF EXISTS "extracted_labels";--> statement-breakpoint
ALTER TABLE "user_memories_preferences" DROP COLUMN IF EXISTS "extracted_scopes";
