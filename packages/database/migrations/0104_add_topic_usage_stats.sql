ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_cost" numeric(20, 6);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_output_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "cost" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "usage" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_model_idx" ON "topics" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topics_provider_idx" ON "topics" USING btree ("provider");
