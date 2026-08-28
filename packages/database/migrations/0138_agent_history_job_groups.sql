CREATE TABLE IF NOT EXISTS "agent_history_job_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"group_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_history_job_groups" DROP CONSTRAINT IF EXISTS "agent_history_job_groups_job_id_agent_history_jobs_id_fk";--> statement-breakpoint
ALTER TABLE "agent_history_job_groups" ADD CONSTRAINT "agent_history_job_groups_job_id_agent_history_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_history_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_history_job_groups" DROP CONSTRAINT IF EXISTS "agent_history_job_groups_group_id_chat_groups_id_fk";--> statement-breakpoint
ALTER TABLE "agent_history_job_groups" ADD CONSTRAINT "agent_history_job_groups_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_history_job_groups_job_id_group_id_unique" ON "agent_history_job_groups" USING btree ("job_id","group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_history_job_groups_group_id_idx" ON "agent_history_job_groups" USING btree ("group_id");
