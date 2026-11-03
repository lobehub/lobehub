ALTER TABLE "documents" ALTER COLUMN "id" SET DATA TYPE varchar(255);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "parent_id" varchar(255);--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "parent_id" varchar(255);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_id_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_parent_id_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_parent_id_idx" ON "documents" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "files_parent_id_idx" ON "files" USING btree ("parent_id");