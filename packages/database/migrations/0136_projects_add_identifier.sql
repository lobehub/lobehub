ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "identifier" varchar(6) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_identifier_user_id_unique" ON "projects" USING btree ("identifier","user_id") WHERE "projects"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_identifier_workspace_id_unique" ON "projects" USING btree ("workspace_id","identifier") WHERE "projects"."workspace_id" IS NOT NULL;
