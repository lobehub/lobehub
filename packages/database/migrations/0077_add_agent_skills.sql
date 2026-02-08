CREATE TABLE IF NOT EXISTS "agent_skills" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"identifier" text NOT NULL,
	"source" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" text,
	"editor_data" jsonb,
	"resources" jsonb DEFAULT '{}'::jsonb,
	"zip_file_hash" varchar(64),
	"user_id" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "agent_skills_zip_file_hash_global_files_hash_id_fk";--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_zip_file_hash_global_files_hash_id_fk" FOREIGN KEY ("zip_file_hash") REFERENCES "public"."global_files"("hash_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" DROP CONSTRAINT IF EXISTS "agent_skills_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_user_name_idx" ON "agent_skills" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_identifier_idx" ON "agent_skills" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_user_id_idx" ON "agent_skills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_source_idx" ON "agent_skills" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_skills_zip_hash_idx" ON "agent_skills" USING btree ("zip_file_hash");--> statement-breakpoint
