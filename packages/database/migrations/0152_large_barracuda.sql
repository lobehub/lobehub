ALTER TABLE "command_execution_logs" ALTER COLUMN "command_text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "command_execution_logs" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "command_execution_logs" ADD COLUMN "policy_field" text;