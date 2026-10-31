ALTER TABLE "agent_eval_environments" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_eval_test_cases" ALTER COLUMN "user_id" DROP NOT NULL;