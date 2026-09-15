ALTER TABLE "document_rewrite_requests" ADD COLUMN "requested_model" text;
--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ADD COLUMN "requested_provider" text;
