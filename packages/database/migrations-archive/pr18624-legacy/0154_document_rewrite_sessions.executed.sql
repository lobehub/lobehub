ALTER TABLE "document_rewrite_requests" ADD COLUMN "session_id" varchar(255);
ALTER TABLE "document_rewrite_requests" ADD COLUMN "parent_request_id" varchar(255);
ALTER TABLE "document_rewrite_requests" ADD COLUMN "turn_index" integer DEFAULT 1;
ALTER TABLE "document_rewrite_requests" ADD COLUMN "output_text" text;
--> statement-breakpoint
UPDATE "document_rewrite_requests"
SET "session_id" = "id"
WHERE "session_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "document_rewrite_requests" ALTER COLUMN "session_id" SET NOT NULL;
ALTER TABLE "document_rewrite_requests" ALTER COLUMN "turn_index" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "document_rewrite_requests_document_session_turn_idx"
  ON "document_rewrite_requests" USING btree ("document_id", "session_id", "turn_index");
CREATE INDEX "document_rewrite_requests_parent_idx"
  ON "document_rewrite_requests" USING btree ("parent_request_id");
