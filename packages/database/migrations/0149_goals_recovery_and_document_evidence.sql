ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "config" jsonb;--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD COLUMN IF NOT EXISTS "document_id" text;--> statement-breakpoint
ALTER TABLE "verify_evidence" DROP CONSTRAINT IF EXISTS "verify_evidence_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "verify_evidence" ADD CONSTRAINT "verify_evidence_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_evidence_document_id_idx" ON "verify_evidence" USING btree ("document_id");
