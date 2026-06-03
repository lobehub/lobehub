ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "usage" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_usage_cost_idx" ON "messages" USING btree ((("usage"->>'cost')::numeric));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_usage_total_tokens_idx" ON "messages" USING btree ((("usage"->>'totalTokens')::numeric));
