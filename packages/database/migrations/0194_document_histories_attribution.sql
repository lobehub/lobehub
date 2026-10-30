ALTER TABLE "document_histories" ADD COLUMN IF NOT EXISTS "editor_ids" text[];--> statement-breakpoint
ALTER TABLE "document_histories" ADD COLUMN IF NOT EXISTS "operation_id" text;--> statement-breakpoint
ALTER TABLE "document_histories" ADD COLUMN IF NOT EXISTS "agent_id" text;