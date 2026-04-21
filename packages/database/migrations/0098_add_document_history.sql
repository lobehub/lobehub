CREATE TABLE IF NOT EXISTS "document_histories" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"editor_data" jsonb NOT NULL,
	"save_source" text NOT NULL,
	"saved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_histories" DROP CONSTRAINT IF EXISTS "document_histories_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "document_histories" ADD CONSTRAINT "document_histories_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_histories" DROP CONSTRAINT IF EXISTS "document_histories_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "document_histories" ADD CONSTRAINT "document_histories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_histories_document_id_idx" ON "document_histories" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_histories_user_id_idx" ON "document_histories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_histories_saved_at_idx" ON "document_histories" USING btree ("saved_at");
