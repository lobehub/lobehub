ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_name_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "agents_slug_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "agent_eval_benchmarks_identifier_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "agent_eval_datasets_identifier_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "agent_skills_user_name_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "documents_slug_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "slug_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_identifier_idx";--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_user_id_role_id_pk";--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD COLUMN IF NOT EXISTS "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rbac_roles_name_workspace_unique" ON "rbac_roles" USING btree ("name",COALESCE("workspace_id", ''));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rbac_user_roles_user_role_scope_unique" ON "rbac_user_roles" USING btree ("user_id","role_id",COALESCE("workspace_id", ''));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_slug_user_id_unique" ON "agents" USING btree ("slug","user_id") WHERE "agents"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_benchmarks_identifier_user_id_unique" ON "agent_eval_benchmarks" USING btree ("identifier","user_id") WHERE "agent_eval_benchmarks"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_eval_datasets_identifier_user_id_unique" ON "agent_eval_datasets" USING btree ("identifier","user_id") WHERE "agent_eval_datasets"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_user_name_idx" ON "agent_skills" USING btree ("user_id","name") WHERE "agent_skills"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_slug_user_id_unique" ON "documents" USING btree ("slug","user_id") WHERE "documents"."workspace_id" IS NULL AND "documents"."slug" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slug_user_id_unique" ON "sessions" USING btree ("slug","user_id") WHERE "sessions"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_identifier_idx" ON "tasks" USING btree ("identifier","created_by_user_id") WHERE "tasks"."workspace_id" is null;
