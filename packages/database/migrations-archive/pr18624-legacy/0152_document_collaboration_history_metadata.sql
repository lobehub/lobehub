ALTER TABLE "document_histories" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "document_histories" ADD COLUMN "source" text;--> statement-breakpoint
CREATE UNIQUE INDEX "document_histories_document_source_request_unique" ON "document_histories" USING btree ("document_id","source","request_id") WHERE "document_histories"."request_id" IS NOT NULL;
