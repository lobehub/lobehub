ALTER TABLE "document_rewrite_requests" ADD COLUMN "progress" jsonb;
--> statement-breakpoint
ALTER TABLE "document_rewrite_requests"
  ADD CONSTRAINT "document_rewrite_requests_progress_size_check"
  CHECK ("document_rewrite_requests"."progress" IS NULL OR pg_column_size("document_rewrite_requests"."progress") <= 32768);
