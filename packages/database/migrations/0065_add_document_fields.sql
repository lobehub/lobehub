ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "knowledge_base_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_knowledge_base_id_idx" ON "documents" USING btree ("knowledge_base_id");
