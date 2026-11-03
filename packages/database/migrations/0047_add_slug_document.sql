ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "slug" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_slug_user_id_unique" ON "documents" USING btree ("slug","user_id") WHERE "documents"."slug" is not null;
