ALTER TABLE "agent_history_job_topics" ADD COLUMN IF NOT EXISTS "payload" jsonb;--> statement-breakpoint
ALTER TABLE "agent_history_jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb;